const mocks = vi.hoisted(() => ({
  speechCreate: vi.fn(),
  allowance: vi.fn(),
  lock: vi.fn(),
  insideLock: false,
}));

vi.mock("../lib/feature-flags", () => ({
  isEnabled: () => true,
}));

vi.mock("./openai-client", () => ({
  createOpenAiClient: () => ({
    audio: { speech: { create: mocks.speechCreate } },
  }),
}));

vi.mock("./ai-usage", () => ({
  voiceAiAllowance: mocks.allowance,
  withVoiceAiLock: mocks.lock,
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamSynthesizeSpeech } from "./tts";

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("RECALL_VOICE_AI_ENABLED", "true");
  vi.stubEnv("RECALL_SERVER_TTS_ENABLED", "true");
  vi.stubEnv("RECALL_OPENAI_TTS_ENABLED", "true");
  mocks.allowance.mockReset();
  mocks.allowance.mockResolvedValue({ allowed: true, remaining: 1000 });
  mocks.lock.mockReset();
  mocks.insideLock = false;
  mocks.lock.mockImplementation(async (_userId: string, fn: () => Promise<unknown>) => {
    mocks.insideLock = true;
    try {
      return await fn();
    } finally {
      mocks.insideLock = false;
    }
  });
  mocks.speechCreate.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("streamSynthesizeSpeech", () => {
  it("passes the first upstream chunk through without buffering the full mp3", async () => {
    const startedAt = performance.now();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        await new Promise((resolve) => setTimeout(resolve, 120));
        controller.enqueue(new Uint8Array([4, 5]));
        controller.close();
      },
    });
    mocks.speechCreate.mockResolvedValue({
      body: stream,
      arrayBuffer: vi.fn(),
    });

    const chunks: number[][] = [];
    let firstChunkMs = Number.NaN;
    await streamSynthesizeSpeech(
      "A short grounded answer.",
      "user-1",
      async ({ stream: body, contentType }) => {
        expect(mocks.insideLock).toBe(false);
        expect(contentType).toBe("audio/mpeg");
        const reader = body.getReader();
        const first = await reader.read();
        firstChunkMs = performance.now() - startedAt;
        chunks.push([...first.value!]);
        expect(chunks).toEqual([[1, 2, 3]]);
        const second = await reader.read();
        chunks.push([...second.value!]);
        expect((await reader.read()).done).toBe(true);
      },
    );
    const completeMs = performance.now() - startedAt;

    expect(chunks).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
    expect(mocks.allowance).toHaveBeenCalledWith("voice_tts", "user-1", 24);
    expect(firstChunkMs).toBeLessThan(completeMs - 80);
    console.info(
      `[tts-stream-benchmark] buffered_first_sound_ms=${completeMs.toFixed(1)} streamed_first_chunk_ms=${firstChunkMs.toFixed(1)} complete_ms=${completeMs.toFixed(1)}`,
    );
  });
});
