import { createServer, type Server } from "node:http";
import { PassThrough } from "node:stream";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  speechCreate: vi.fn(),
}));

vi.mock("../lib/feature-flags", () => ({
  isEnabled: () => true,
}));

vi.mock("../services/openai-client", () => ({
  createOpenAiClient: () => ({
    audio: { speech: { create: mocks.speechCreate } },
  }),
}));

vi.mock("../services/ai-usage", () => ({
  voiceAiAllowance: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 100_000,
  }),
  withVoiceAiLock: vi.fn(
    async (_userId: string, fn: () => Promise<unknown>) => fn(),
  ),
}));

import aiRouter from "./ai";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("RECALL_VOICE_AI_ENABLED", "true");
  vi.stubEnv("RECALL_SERVER_TTS_ENABLED", "true");
  vi.stubEnv("RECALL_OPENAI_TTS_ENABLED", "true");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: "11111111-1111-4111-8111-111111111111",
      email: "voice@example.com",
      name: "Voice Test",
      isAdmin: false,
    };
    next();
  });
  app.use(aiRouter);
  app.use(
    (
      error: Error & { status?: number },
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      res
        .status(error.status ?? 500)
        .json({ error: "REQUEST_ERROR", message: error.message });
    },
  );
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not bind TTS streaming test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  mocks.speechCreate.mockReset();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function postTts() {
  return fetch(`${baseUrl}/ai/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "A streamed answer." }),
  });
}

describe("POST /ai/tts Node stream handling", () => {
  it("streams a real PassThrough body without calling getReader", async () => {
    const body = new PassThrough();
    mocks.speechCreate.mockResolvedValue({ body, arrayBuffer: vi.fn() });
    queueMicrotask(() => {
      body.write(Buffer.from([1, 2]));
      body.end(Buffer.from([3, 4]));
    });

    const response = await postTts();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("audio/mpeg");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("returns JSON when the upstream errors before the first byte", async () => {
    const body = new PassThrough();
    body.on("error", () => undefined);
    mocks.speechCreate.mockResolvedValue({ body, arrayBuffer: vi.fn() });
    queueMicrotask(() => body.destroy(new Error("upstream reset")));

    const response = await postTts();
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      error: "REQUEST_ERROR",
      message: "OpenAI TTS stream failed",
    });
  });

  it("terminates an audio response when the upstream errors mid-stream", async () => {
    const body = new PassThrough();
    body.on("error", () => undefined);
    mocks.speechCreate.mockResolvedValue({ body, arrayBuffer: vi.fn() });
    queueMicrotask(() => {
      body.write(Buffer.from([9, 8, 7]));
      setTimeout(() => body.destroy(new Error("upstream reset")), 10);
    });

    const response = await postTts();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("audio/mpeg");
    await expect(response.arrayBuffer()).rejects.toThrow();
  });
});
