import { isEnabled } from "../lib/feature-flags";
import { createOpenAiClient } from "./openai-client";
import { voiceAiAllowance, withVoiceAiLock } from "./ai-usage";

export const OPENAI_TTS_VOICES = ["onyx"] as const;

export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];

export const OPENAI_TTS_MODELS = ["tts-1"] as const;
export type OpenAiTtsModel = (typeof OPENAI_TTS_MODELS)[number];

export function isOpenAiTtsVoice(value: string): value is OpenAiTtsVoice {
  return (OPENAI_TTS_VOICES as readonly string[]).includes(value);
}

export function isOpenAiTtsModel(value: string): value is OpenAiTtsModel {
  return (OPENAI_TTS_MODELS as readonly string[]).includes(value);
}

export function getOpenAiTtsSettings(): {
  model: OpenAiTtsModel;
  voice: OpenAiTtsVoice;
} {
  const configuredModel =
    process.env.RECALL_TTS_MODEL?.trim() ||
    process.env.OPENAI_TTS_MODEL?.trim() ||
    "tts-1";
  const configuredVoice =
    process.env.RECALL_TTS_VOICE?.trim() ||
    process.env.OPENAI_TTS_VOICE?.trim() ||
    "onyx";
  if (!isOpenAiTtsModel(configuredModel)) {
    throw Object.assign(new Error("Configured TTS model is not allowed"), {
      status: 503,
    });
  }
  if (!isOpenAiTtsVoice(configuredVoice)) {
    throw Object.assign(new Error("Configured TTS voice is not allowed"), {
      status: 503,
    });
  }
  return {
    model: configuredModel,
    voice: configuredVoice,
  };
}

export function assertServerTtsEnabled(): void {
  if (
    !isEnabled("RECALL_VOICE_AI_ENABLED", false) ||
    !isEnabled("RECALL_SERVER_TTS_ENABLED") ||
    !isEnabled("RECALL_OPENAI_TTS_ENABLED")
  ) {
    const err = new Error("Server TTS is disabled") as Error & {
      status?: number;
      code?: string;
    };
    err.status = 503;
    err.code = "disabled";
    throw err;
  }
}

/**
 * Synthesize speech with OpenAI TTS.
 * Defaults: model tts-1 (fast/cheap), voice onyx.
 * Override with RECALL_TTS_MODEL / RECALL_TTS_VOICE.
 * Disabled unless the master, server, and provider flags are explicitly enabled.
 */
export async function synthesizeSpeech(
  text: string,
  userId: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const response = await createSpeechForUser(text, userId);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: "audio/mpeg",
  };
}

type SpeechResponse = {
  arrayBuffer(): Promise<ArrayBuffer>;
  body: unknown;
};

type WebAudioStream = {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(reason?: unknown): Promise<void>;
    releaseLock(): void;
  };
};

function audioChunk(value: unknown): Uint8Array {
  if (typeof value === "string") return Buffer.from(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw Object.assign(new Error("OpenAI TTS returned an invalid audio chunk"), {
    status: 502,
  });
}

function streamFailure(error: unknown): Error & { status: number } {
  return Object.assign(
    new Error("OpenAI TTS stream failed", { cause: error }),
    {
      status: 502,
    },
  );
}

/**
 * OpenAI SDK v4 can expose Response.body as either a Node Readable/PassThrough
 * or a WHATWG ReadableStream depending on its runtime transport.
 */
export function speechBodyChunks(body: unknown): AsyncIterable<Uint8Array> {
  if (
    body &&
    typeof body === "object" &&
    Symbol.asyncIterator in body &&
    typeof body[Symbol.asyncIterator] === "function"
  ) {
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const chunk of body as AsyncIterable<unknown>) {
            yield audioChunk(chunk);
          }
        } catch (error) {
          throw streamFailure(error);
        }
      },
    };
  }

  if (
    body &&
    typeof body === "object" &&
    "getReader" in body &&
    typeof body.getReader === "function"
  ) {
    return {
      async *[Symbol.asyncIterator]() {
        const reader = (body as WebAudioStream).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) yield audioChunk(value);
          }
        } catch (error) {
          throw streamFailure(error);
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      },
    };
  }

  throw Object.assign(
    new Error("OpenAI TTS returned no readable audio stream"),
    {
      status: 502,
    },
  );
}

async function createSpeechForUser(
  text: string,
  userId: string,
): Promise<SpeechResponse> {
  assertServerTtsEnabled();

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not configured") as Error & {
      status?: number;
    };
    err.status = 503;
    throw err;
  }

  const cleaned = text.replace(/\s+/g, " ").trim().slice(0, 4096);
  if (!cleaned) {
    const err = new Error("Text is required") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  return withVoiceAiLock(userId, async () => {
    const allowance = await voiceAiAllowance(
      "voice_tts",
      userId,
      cleaned.length,
    );
    if (!allowance.allowed) {
      const message =
        allowance.reason === "monthly_limit"
          ? "Monthly voice limit reached. Free search still works."
          : allowance.reason === "daily_limit"
            ? "Daily voice limit reached. Free search still works."
            : "Server TTS is unavailable";
      throw Object.assign(new Error(message), {
        status:
          allowance.reason === "daily_limit" ||
          allowance.reason === "monthly_limit"
            ? 429
            : 503,
        code: allowance.reason,
      });
    }

    const settings = getOpenAiTtsSettings();
    const client = createOpenAiClient({ apiKey, feature: "voice_tts", userId });
    const response = (await client.audio.speech.create({
      model: settings.model,
      voice: settings.voice,
      input: cleaned,
      response_format: "mp3",
    })) as SpeechResponse;
    return response;
  });
}

/**
 * OpenAI accepts the call and strict usage logging completes inside the paid
 * call lock. Client download backpressure happens after releasing the advisory
 * lock so a slow connection cannot hold a database connection.
 */
export async function streamSynthesizeSpeech(
  text: string,
  userId: string,
  consume: (input: {
    chunks: AsyncIterable<Uint8Array>;
    contentType: string;
  }) => Promise<void>,
): Promise<void> {
  const response = await createSpeechForUser(text, userId);
  const chunks = speechBodyChunks(response.body);
  await consume({ chunks, contentType: "audio/mpeg" });
}
