import OpenAI from "openai";
import {
  AiSpendBlockedError,
  assertAiSpendAllowed,
  currentAiFeature,
  isBackgroundFeature,
  recordAiUsage,
  usageTokens,
  type AiFeature,
} from "./ai-usage";

type ClientOptions = {
  apiKey: string;
  feature?: AiFeature;
  userId?: string | null;
  background?: boolean;
};

type UsageLike = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

function estimatedTextTokens(value: unknown): number {
  return Math.ceil(String(value ?? "").length / 4);
}

function ttsCostMicros(model: string, input: unknown): number {
  const chars = String(input ?? "").length;
  const microsPerCharacter = model.toLowerCase().includes("hd") ? 30 : 15;
  return chars * microsPerCharacter;
}

function transcriptionCostMicros(result: unknown): number {
  const seconds = Number((result as { duration?: unknown })?.duration ?? 0);
  // Whisper pricing is $0.006/minute, or 100 micro-dollars per second.
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 100) : 0;
}

/**
 * The only allowed OpenAI client constructor in the API. Every provider call
 * is recorded synchronously before control returns to the caller. Failed
 * provider attempts are logged with zero tokens/cost; cache hits never reach
 * this factory and therefore do not create misleading usage rows.
 */
export function createOpenAiClient(options: ClientOptions): OpenAI {
  const client = new OpenAI({ apiKey: options.apiKey });

  const context = () => {
    const ambient = currentAiFeature();
    const feature = options.feature ?? ambient.feature;
    const userId =
      options.userId === undefined ? ambient.userId : options.userId;
    return {
      feature,
      userId,
      background: options.background ?? isBackgroundFeature(feature),
    };
  };

  const record = async (
    model: string,
    usage?: UsageLike | null,
    costMicros?: number,
    measurements?: { characters?: number; seconds?: number },
  ): Promise<void> => {
    const ctx = context();
    await recordAiUsage(
      {
        ...ctx,
        provider: "openai",
        model: model || "unknown",
        ...usageTokens(usage),
        ...measurements,
        ...(costMicros === undefined ? {} : { costMicros }),
      },
      { strict: true },
    );
  };

  const completions = client.chat.completions as unknown as {
    create: (
      params: Record<string, unknown>,
      requestOptions?: unknown,
    ) => Promise<unknown>;
  };
  const createCompletion = completions.create.bind(completions);
  completions.create = async (params, requestOptions) => {
    const model = String(params.model ?? "unknown");
    try {
      await assertAiSpendAllowed();
      const request = params.stream
        ? {
            ...params,
            stream_options: {
              ...((params.stream_options as
                | Record<string, unknown>
                | undefined) ?? {}),
              include_usage: true,
            },
          }
        : params;
      const result = await createCompletion(request, requestOptions);
      if (!params.stream) {
        await record(model, (result as { usage?: UsageLike }).usage);
        return result;
      }

      const stream = result as AsyncIterable<{
        usage?: UsageLike | null;
      }>;
      return {
        async *[Symbol.asyncIterator]() {
          let usage: UsageLike | null = null;
          let failed = false;
          try {
            for await (const chunk of stream) {
              if (chunk.usage) usage = chunk.usage;
              yield chunk;
            }
          } catch (err) {
            failed = true;
            await record(model, null, 0);
            throw err;
          } finally {
            if (!failed) await record(model, usage);
          }
        },
      };
    } catch (err) {
      if (err instanceof AiSpendBlockedError) throw err;
      await record(model, null, 0);
      throw err;
    }
  };

  const embeddings = client.embeddings as unknown as {
    create: (
      params: Record<string, unknown>,
      requestOptions?: unknown,
    ) => Promise<unknown>;
  };
  const createEmbedding = embeddings.create.bind(embeddings);
  embeddings.create = async (params, requestOptions) => {
    const model = String(params.model ?? "unknown");
    try {
      await assertAiSpendAllowed();
      const result = await createEmbedding(params, requestOptions);
      await record(model, (result as { usage?: UsageLike }).usage);
      return result;
    } catch (err) {
      if (err instanceof AiSpendBlockedError) throw err;
      await record(model, null, 0);
      throw err;
    }
  };

  const speech = client.audio.speech as unknown as {
    create: (
      params: Record<string, unknown>,
      requestOptions?: unknown,
    ) => Promise<unknown>;
  };
  const createSpeech = speech.create.bind(speech);
  speech.create = async (params, requestOptions) => {
    const model = String(params.model ?? "tts-1");
    try {
      await assertAiSpendAllowed();
      const result = await createSpeech(params, requestOptions);
      await record(
        model,
        {
          prompt_tokens: estimatedTextTokens(params.input),
          completion_tokens: 0,
        },
        ttsCostMicros(model, params.input),
        { characters: String(params.input ?? "").length },
      );
      return result;
    } catch (err) {
      if (err instanceof AiSpendBlockedError) throw err;
      await record(model, null, 0);
      throw err;
    }
  };

  const transcriptions = client.audio.transcriptions as unknown as {
    create: (
      params: Record<string, unknown>,
      requestOptions?: unknown,
    ) => Promise<unknown>;
  };
  const createTranscription = transcriptions.create.bind(transcriptions);
  transcriptions.create = async (params, requestOptions) => {
    const model = String(params.model ?? "whisper-1");
    try {
      await assertAiSpendAllowed();
      const result = await createTranscription(params, requestOptions);
      const seconds = Number((result as { duration?: unknown })?.duration ?? 0);
      await record(model, null, transcriptionCostMicros(result), {
        seconds: Number.isFinite(seconds) ? seconds : 0,
      });
      return result;
    } catch (err) {
      if (err instanceof AiSpendBlockedError) throw err;
      await record(model, null, 0);
      throw err;
    }
  };

  return client;
}
