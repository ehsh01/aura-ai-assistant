import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  embeddings: vi.fn(),
  speech: vi.fn(),
  transcriptions: vi.fn(),
  record: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: mocks.chat } };
    embeddings = { create: mocks.embeddings };
    audio = {
      speech: { create: mocks.speech },
      transcriptions: { create: mocks.transcriptions },
    };
  },
}));

vi.mock("./ai-usage", () => ({
  currentAiFeature: () => ({ feature: "other" }),
  isBackgroundFeature: () => false,
  recordAiUsage: mocks.record,
  usageTokens: (
    usage: { prompt_tokens?: number; completion_tokens?: number } | null = {},
  ) => ({
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
  }),
}));

import { createOpenAiClient } from "./openai-client";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.record.mockResolvedValue(undefined);
});

describe("instrumented OpenAI client", () => {
  it("records chat and embedding tokens before returning", async () => {
    mocks.chat.mockResolvedValue({
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    });
    mocks.embeddings.mockResolvedValue({
      data: [],
      usage: { prompt_tokens: 7 },
    });
    const client = createOpenAiClient({
      apiKey: "test",
      feature: "intent_route",
      userId: "user-1",
    });

    await client.chat.completions.create({ model: "gpt-test", messages: [] });
    await client.embeddings.create({ model: "embed-test", input: ["hello"] });

    expect(mocks.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: "user-1",
        feature: "intent_route",
        model: "gpt-test",
        promptTokens: 12,
        completionTokens: 3,
      }),
      { strict: true },
    );
    expect(mocks.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        model: "embed-test",
        promptTokens: 7,
        completionTokens: 0,
      }),
      { strict: true },
    );
  });

  it("records failed provider attempts with zero usage and rethrows", async () => {
    mocks.chat.mockRejectedValue(new Error("provider down"));
    const client = createOpenAiClient({
      apiKey: "test",
      feature: "ask_query",
      userId: "user-1",
    });

    await expect(
      client.chat.completions.create({ model: "gpt-test", messages: [] }),
    ).rejects.toThrow("provider down");
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "ask_query",
        promptTokens: 0,
        completionTokens: 0,
        costMicros: 0,
      }),
      { strict: true },
    );
  });

  it("records estimated TTS and duration-priced transcription cost", async () => {
    mocks.speech.mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    mocks.transcriptions.mockResolvedValue({ text: "hello", duration: 2.5 });
    const client = createOpenAiClient({
      apiKey: "test",
      feature: "voice_tts",
      userId: "user-1",
    });

    await client.audio.speech.create({
      model: "tts-1",
      voice: "nova",
      input: "12345678",
    });
    await client.audio.transcriptions.create({
      model: "whisper-1",
      file: new File([], "audio.webm"),
    });

    expect(mocks.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        provider: "openai",
        feature: "voice_tts",
        promptTokens: 2,
        characters: 8,
        costMicros: 120,
      }),
      { strict: true },
    );
    expect(mocks.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        provider: "openai",
        model: "whisper-1",
        seconds: 2.5,
        costMicros: 250,
      }),
      { strict: true },
    );
  });
});
