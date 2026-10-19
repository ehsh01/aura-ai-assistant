import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  embeddings: vi.fn(),
  speech: vi.fn(),
  transcriptions: vi.fn(),
  record: vi.fn(),
  spendGuard: vi.fn(),
  spendLock: vi.fn(),
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
  AiSpendBlockedError: class extends Error {},
  assertAiSpendAllowed: mocks.spendGuard,
  currentAiFeature: () => ({ feature: "other" }),
  isBackgroundFeature: () => false,
  recordAiUsage: mocks.record,
  withAiSpendLock: mocks.spendLock,
  usageTokens: (
    usage: { prompt_tokens?: number; completion_tokens?: number } | null = {},
  ) => ({
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
  }),
}));

import {
  createOpenAiClient,
  resetCredentialMemoryForTests,
} from "./openai-client";
import { HIDDEN_ADDRESS, HIDDEN_CREDENTIAL } from "./secret-redaction";

beforeEach(() => {
  resetCredentialMemoryForTests();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.record.mockResolvedValue(undefined);
  mocks.spendGuard.mockResolvedValue(undefined);
  mocks.spendLock.mockImplementation((fn: () => Promise<unknown>) => fn());
});

describe("instrumented OpenAI client", () => {
  it("redacts chat and TTS request bodies before the provider call", async () => {
    const password = "FakePsychiatryPassword!42";
    const spacesKey = "DO00FAKEACCESSKEY123";
    const bareSpacesKey = "QWxhZGRpbjpPcGVuU2VzYW1lMTIzNDU2Nzg5MDEAB12";
    const spacesSecret = "FAKESECRETKEY1234567890123456789012345678";
    const sshBare = "Abc123xyzAbc123xyz@Q@Wordtail9";
    const commandToken = "Abc123xyzAbc123xyz@Q@Wordtail9";
    const apiKey = "sk-proj-FakeOpenAiKey1234567890";
    const fixture = `Psychiatry Inventory App
SSH host: inventory.example.health
SSH user: psychiatry-admin
SSH password: ${password}
Spaces access key: ${spacesKey}
Spaces Key: ${bareSpacesKey}
Spaces secret key: ${spacesSecret}
API Key: ${apiKey}
ssh root@10.20.30.40
${sshBare}
deploy user:${commandToken}/var/www/x`;
    mocks.chat.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              `Password: ${sshBare}\n` +
              `Spaces Key: ${bareSpacesKey}\n` +
              "Echoed tail: Wordtail9",
          },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    });
    mocks.speech.mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const client = createOpenAiClient({
      apiKey: "test",
      feature: "voice_ask",
      userId: "user-1",
    });

    const chat = await client.chat.completions.create({
      model: "gpt-test",
      messages: [{ role: "user", content: fixture }],
    });
    await client.audio.speech.create({
      model: "tts-1",
      voice: "onyx",
      input: fixture,
    });

    const chatBody = JSON.stringify(mocks.chat.mock.calls[0]?.[0]);
    const speechBody = JSON.stringify(mocks.speech.mock.calls[0]?.[0]);
    for (const secret of [
      password,
      spacesKey,
      bareSpacesKey,
      spacesSecret,
      sshBare,
      commandToken,
      apiKey,
    ]) {
      expect(chatBody).not.toContain(secret);
      expect(speechBody).not.toContain(secret);
      expect(JSON.stringify(chat)).not.toContain(secret);
    }
    expect(chatBody).toContain(HIDDEN_CREDENTIAL);
    expect(speechBody).toContain(HIDDEN_CREDENTIAL);
    for (const fragment of [
      "Abc123xyzAbc123xyz",
      "Wordtail9",
      "Q@Word",
      "NDU2Nzg5MDEAB12",
    ]) {
      expect(chatBody).not.toContain(fragment);
      expect(speechBody).not.toContain(fragment);
      expect(JSON.stringify(chat)).not.toContain(fragment);
    }
    expect(chatBody).not.toContain("credential]credential]");
    expect(speechBody).not.toContain("credential]credential]");
  });

  it("redacts addresses before answer synthesis, output, and TTS", async () => {
    const fixture = `Server Inventory
IP: 10.20.30.40
server: 10. 20.
Host: inventory-node.example
DB: db-node.fake.internal:5432
Runbook: https://dadeschools.net/server-guide
SSH: deploy@inventory-node.fake.internal`;
    mocks.chat.mockResolvedValue({
      choices: [
        {
          message: {
            content: "Connect to 10.20.30.40 or INVENTORY-NODE.EXAMPLE.",
          },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    });
    mocks.speech.mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const client = createOpenAiClient({
      apiKey: "test",
      feature: "voice_ask",
      userId: "address-redaction-user",
    });

    const chat = await client.chat.completions.create({
      model: "gpt-test",
      messages: [{ role: "user", content: fixture }],
    });
    await client.audio.speech.create({
      model: "tts-1",
      voice: "onyx",
      input: "Connect to 10.20.30.40 or INVENTORY-NODE.EXAMPLE.",
    });

    const chatBody = JSON.stringify(mocks.chat.mock.calls[0]?.[0]);
    const outputBody = JSON.stringify(chat);
    const speechBody = JSON.stringify(mocks.speech.mock.calls[0]?.[0]);
    for (const sensitive of [
      "10.20.30.40",
      "10. 20.",
      "inventory-node.fake.internal",
      "inventory-node.example",
      "INVENTORY-NODE.EXAMPLE",
      "db-node.fake.internal",
    ]) {
      expect(chatBody).not.toContain(sensitive);
      expect(outputBody).not.toContain(sensitive);
      expect(speechBody).not.toContain(sensitive);
    }
    expect(chatBody).toContain(HIDDEN_ADDRESS);
    expect(outputBody).toContain(HIDDEN_ADDRESS);
    expect(speechBody).toContain(HIDDEN_ADDRESS);
    expect(chatBody).toContain("https://dadeschools.net/server-guide");
    expect(mocks.chat).toHaveBeenCalledOnce();
    expect(mocks.speech).toHaveBeenCalledOnce();
  });

  it("redacts markup-glued TTS values and learned secret tails", async () => {
    const prefix = "Ab1cD2e";
    const tail = "Fg3Hi4Jk5Lm6No7Pq";
    const glued = `${prefix}\"><${tail}`;
    mocks.chat.mockResolvedValue({
      choices: [{ message: { content: "Safe response" } }],
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    });
    mocks.speech.mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const client = createOpenAiClient({
      apiKey: "test",
      feature: "voice_ask",
      userId: "tts-learned-secret-user",
    });

    await client.chat.completions.create({
      model: "gpt-test",
      messages: [{ role: "user", content: `Key: ${glued}` }],
    });
    await client.audio.speech.create({
      model: "tts-1",
      voice: "onyx",
      input: `key: ${glued}`,
    });
    await client.audio.speech.create({
      model: "tts-1",
      voice: "onyx",
      input: `Read this tail aloud: ${tail}`,
    });

    for (const call of mocks.speech.mock.calls) {
      const body = JSON.stringify(call[0]);
      expect(body).not.toContain(prefix);
      expect(body).not.toContain(tail);
      expect(body).not.toContain("credential]credential]");
      expect(body).not.toContain("[[hidden credential]");
      expect(body).not.toContain("]]");
    }
  });

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
    expect(mocks.spendGuard).toHaveBeenCalledTimes(2);
    expect(mocks.spendLock).toHaveBeenCalledTimes(2);
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
      voice: "onyx",
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
    expect(mocks.spendGuard).toHaveBeenCalledTimes(2);
    expect(mocks.spendLock).toHaveBeenCalledTimes(2);
  });

  it("keeps a streamed completion inside the spend lock through usage recording", async () => {
    const events: string[] = [];
    mocks.spendLock.mockImplementation(async (fn: () => Promise<unknown>) => {
      events.push("lock:start");
      const result = await fn();
      events.push("lock:end");
      return result;
    });
    mocks.chat.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        events.push("stream:chunk");
        yield { choices: [], usage: null };
        yield {
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 3 },
        };
      },
    });
    mocks.record.mockImplementation(async () => {
      events.push("usage:recorded");
    });
    const client = createOpenAiClient({
      apiKey: "test",
      feature: "ask_query",
      userId: "user-1",
    });

    const stream = await client.chat.completions.create({
      model: "gpt-test",
      messages: [],
      stream: true,
    });
    for await (const _chunk of stream as unknown as AsyncIterable<unknown>) {
      // Drain the instrumented stream.
    }
    await vi.waitFor(() => expect(events).toContain("lock:end"));

    expect(events).toEqual([
      "lock:start",
      "stream:chunk",
      "usage:recorded",
      "lock:end",
    ]);
    expect(mocks.record).toHaveBeenCalledOnce();
  });

  it("redacts a credential split across streamed chunks before emission", async () => {
    const secret = "FakePsychiatryPassword!42";
    mocks.chat.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [
            { delta: { content: "The SSH password is FakePsychiatry" } },
          ],
          usage: null,
        };
        yield {
          choices: [{ delta: { content: "Password!42" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
      },
    });
    const client = createOpenAiClient({
      apiKey: "test",
      feature: "ask_query",
      userId: "user-1",
    });
    const stream = await client.chat.completions.create({
      model: "gpt-test",
      messages: [],
      stream: true,
    });

    let output = "";
    for await (const chunk of stream as unknown as AsyncIterable<{
      choices?: Array<{ delta?: { content?: string } }>;
    }>) {
      output += chunk.choices?.[0]?.delta?.content ?? "";
    }

    expect(output).not.toContain(secret);
    expect(output).toContain(HIDDEN_CREDENTIAL);
  });

  it("does not start a concurrent provider call before the locked call records usage", async () => {
    let tail = Promise.resolve();
    mocks.spendLock.mockImplementation((fn: () => Promise<unknown>) => {
      const run = tail.then(fn);
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    });
    let releaseFirst!: () => void;
    const firstProvider = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mocks.chat
      .mockImplementationOnce(async () => {
        await firstProvider;
        return {
          choices: [],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        };
      })
      .mockResolvedValueOnce({
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    const client = createOpenAiClient({ apiKey: "test" });

    const first = client.chat.completions.create({
      model: "gpt-test",
      messages: [],
    });
    const second = client.chat.completions.create({
      model: "gpt-test",
      messages: [],
    });
    await vi.waitFor(() => expect(mocks.chat).toHaveBeenCalledTimes(1));
    releaseFirst();
    await Promise.all([first, second]);

    expect(mocks.chat).toHaveBeenCalledTimes(2);
    expect(mocks.record).toHaveBeenCalledTimes(2);
  });
});
