import { isEnabled } from "../lib/feature-flags";
import { createOpenAiClient } from "./openai-client";
import { voiceAiAllowance, withVoiceAiLock } from "./ai-usage";

export const OPENAI_TTS_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;

export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];

export const OPENAI_TTS_MODELS = ["tts-1", "gpt-4o-mini-tts"] as const;
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
  instructions?: string;
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
  const instructions = process.env.RECALL_TTS_INSTRUCTIONS?.trim();
  return {
    model: configuredModel,
    voice: configuredVoice,
    // The legacy tts-1 endpoint does not accept instructions.
    ...(configuredModel === "gpt-4o-mini-tts" && instructions
      ? { instructions: instructions.slice(0, 2000) }
      : {}),
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
  return createSpeechForUser(text, userId, async (response) => ({
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: "audio/mpeg",
  }));
}

type SpeechResponse = {
  arrayBuffer(): Promise<ArrayBuffer>;
  body: ReadableStream<Uint8Array> | null;
};

async function createSpeechForUser<T>(
  text: string,
  userId: string,
  consume: (response: SpeechResponse) => Promise<T>,
): Promise<T> {
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
        allowance.reason === "daily_limit"
          ? "Daily voice limit reached. Free search still works."
          : "Server TTS is unavailable";
      throw Object.assign(new Error(message), {
        status: allowance.reason === "daily_limit" ? 429 : 503,
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
      ...(settings.instructions ? { instructions: settings.instructions } : {}),
    })) as SpeechResponse;
    return consume(response);
  });
}

/**
 * Keep the paid-call lock and usage accounting active until the downstream
 * response has consumed the OpenAI body. No transcript is added to usage logs.
 */
export async function streamSynthesizeSpeech(
  text: string,
  userId: string,
  consume: (input: {
    stream: ReadableStream<Uint8Array>;
    contentType: string;
  }) => Promise<void>,
): Promise<void> {
  return createSpeechForUser(text, userId, async (response) => {
    if (!response.body) {
      throw Object.assign(new Error("OpenAI TTS returned no audio stream"), {
        status: 502,
      });
    }
    await consume({ stream: response.body, contentType: "audio/mpeg" });
  });
}
