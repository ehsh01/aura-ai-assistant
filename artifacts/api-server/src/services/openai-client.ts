import OpenAI from "openai";
import {
  AiSpendBlockedError,
  assertAiSpendAllowed,
  currentAiFeature,
  isBackgroundFeature,
  recordAiUsage,
  usageTokens,
  withAiSpendLock,
  type AiFeature,
} from "./ai-usage";
import {
  redactCredentials,
  redactSensitiveValue,
  withCredentialRedactionScope,
} from "./secret-redaction";

type ClientOptions = {
  apiKey: string;
  feature?: AiFeature;
  userId?: string | null;
  background?: boolean;
  /** Preserve source extraction output (for example OCR shown in raw note views). */
  redactOutput?: boolean;
};

type UsageLike = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

class AsyncChunkQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private ended = false;
  private failed = false;
  private failure: unknown = null;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value });
    else this.values.push(value);
  }

  end(): void {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  fail(error: unknown): void {
    this.failed = true;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          const value = this.values.shift()!;
          return Promise.resolve({ done: false, value });
        }
        if (this.failed) return Promise.reject(this.failure);
        if (this.ended) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
    };
  }
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

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

function redactBufferedChatChunks<T>(chunks: T[]): T[] {
  const sanitized = redactSensitiveValue(chunks);
  const deltas: Array<{ content?: unknown }> = [];
  let fullContent = "";
  for (const chunk of sanitized as Array<{
    choices?: Array<{ delta?: { content?: unknown } }>;
  }>) {
    for (const choice of chunk.choices ?? []) {
      if (!choice.delta) continue;
      deltas.push(choice.delta);
      if (typeof choice.delta.content === "string") {
        fullContent += choice.delta.content;
      }
    }
  }
  const redactedContent = redactCredentials(fullContent);
  let emitted = false;
  for (const delta of deltas) {
    if (typeof delta.content !== "string") continue;
    delta.content = emitted ? "" : redactedContent;
    emitted = true;
  }
  return sanitized;
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
    callContext = context(),
  ): Promise<void> => {
    await recordAiUsage(
      {
        ...callContext,
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
  completions.create = (params, requestOptions) =>
    withCredentialRedactionScope(async () => {
    const model = String(params.model ?? "unknown");
    const callContext = context();
    const sanitizedParams = redactSensitiveValue(params);
    const request = sanitizedParams.stream
      ? {
          ...sanitizedParams,
          stream_options: {
            ...((sanitizedParams.stream_options as
              | Record<string, unknown>
              | undefined) ?? {}),
            include_usage: true,
          },
        }
      : sanitizedParams;
    if (!params.stream) {
      return withAiSpendLock(async () => {
        await assertAiSpendAllowed(callContext);
        let result: unknown;
        try {
          result = await createCompletion(request, requestOptions);
        } catch (err) {
          await record(model, null, 0, undefined, callContext);
          throw err;
        }
        await record(
          model,
          (result as { usage?: UsageLike }).usage,
          undefined,
          undefined,
          callContext,
        );
        return options.redactOutput === false
          ? result
          : redactSensitiveValue(result);
      });
    }

    const queue = new AsyncChunkQueue<{ usage?: UsageLike | null }>();
    const ready = deferred();
    let readySettled = false;
    void withAiSpendLock(async () => {
      let providerStarted = false;
      try {
        await assertAiSpendAllowed(callContext);
        const result = await createCompletion(request, requestOptions);
        providerStarted = true;
        const stream = result as AsyncIterable<{
          usage?: UsageLike | null;
        }>;
        readySettled = true;
        ready.resolve();
        let usage: UsageLike | null = null;
        const chunks: Array<{ usage?: UsageLike | null }> = [];
        try {
          for await (const chunk of stream) {
            if (chunk.usage) usage = chunk.usage;
            chunks.push(chunk);
          }
        } catch (err) {
          await record(model, null, 0, undefined, callContext);
          queue.fail(err);
          return;
        }
        await record(model, usage, undefined, undefined, callContext);
        for (const chunk of redactBufferedChatChunks(chunks)) {
          queue.push(chunk);
        }
        queue.end();
      } catch (err) {
        if (!(err instanceof AiSpendBlockedError) && !providerStarted) {
          await record(model, null, 0, undefined, callContext);
        }
        if (!readySettled) ready.reject(err);
        else queue.fail(err);
      }
    }).catch((err) => {
      if (!readySettled) ready.reject(err);
      else queue.fail(err);
    });
    await ready.promise;
      return queue;
    });

  const embeddings = client.embeddings as unknown as {
    create: (
      params: Record<string, unknown>,
      requestOptions?: unknown,
    ) => Promise<unknown>;
  };
  const createEmbedding = embeddings.create.bind(embeddings);
  embeddings.create = async (params, requestOptions) => {
    const model = String(params.model ?? "unknown");
    const callContext = context();
    return withAiSpendLock(async () => {
      await assertAiSpendAllowed(callContext);
      let result: unknown;
      try {
        result = await createEmbedding(
          redactSensitiveValue(params),
          requestOptions,
        );
      } catch (err) {
        await record(model, null, 0, undefined, callContext);
        throw err;
      }
      await record(
        model,
        (result as { usage?: UsageLike }).usage,
        undefined,
        undefined,
        callContext,
      );
      return result;
    });
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
    const callContext = context();
    const sanitizedParams = redactSensitiveValue(params);
    return withAiSpendLock(async () => {
      await assertAiSpendAllowed(callContext);
      let result: unknown;
      try {
        result = await createSpeech(sanitizedParams, requestOptions);
      } catch (err) {
        await record(model, null, 0, undefined, callContext);
        throw err;
      }
      await record(
        model,
        {
          prompt_tokens: estimatedTextTokens(sanitizedParams.input),
          completion_tokens: 0,
        },
        ttsCostMicros(model, sanitizedParams.input),
        { characters: String(sanitizedParams.input ?? "").length },
        callContext,
      );
      return result;
    });
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
    const callContext = context();
    return withAiSpendLock(async () => {
      await assertAiSpendAllowed(callContext);
      let result: unknown;
      try {
        result = await createTranscription(
          redactSensitiveValue(params),
          requestOptions,
        );
      } catch (err) {
        await record(model, null, 0, undefined, callContext);
        throw err;
      }
      const seconds = Number((result as { duration?: unknown })?.duration ?? 0);
      await record(
        model,
        null,
        transcriptionCostMicros(result),
        {
          seconds: Number.isFinite(seconds) ? seconds : 0,
        },
        callContext,
      );
      return result;
    });
  };

  return client;
}
