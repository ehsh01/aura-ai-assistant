import { createServer, type Server } from "node:http";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import aiRouter from "./ai";

const TTS_FLAGS = [
  "RECALL_VOICE_AI_ENABLED",
  "RECALL_SERVER_TTS_ENABLED",
  "RECALL_OPENAI_TTS_ENABLED",
] as const;
const original = new Map(TTS_FLAGS.map((key) => [key, process.env[key]]));
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(aiRouter);
  app.use(
    (
      error: Error & { status?: number },
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      res.status(error.status ?? 500).json({ message: error.message });
    },
  );
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not bind audio flag test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(() => {
  for (const key of TTS_FLAGS) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function postTts() {
  return fetch(`${baseUrl}/ai/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "hello" }),
  });
}

describe("POST /ai/tts paid-audio gates", () => {
  it("returns 503 when all flags are unset", async () => {
    for (const key of TTS_FLAGS) delete process.env[key];
    expect((await postTts()).status).toBe(503);
  });

  it.each(TTS_FLAGS)("returns 503 with only %s enabled", async (enabledKey) => {
    for (const key of TTS_FLAGS) delete process.env[key];
    process.env[enabledKey] = "true";
    expect((await postTts()).status).toBe(503);
  });
});
