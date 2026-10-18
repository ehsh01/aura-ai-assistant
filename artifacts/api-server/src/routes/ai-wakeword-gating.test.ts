import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import aiRouter from "./ai";

const FLAGS = [
  "OPENAI_API_KEY",
  "RECALL_WAKEWORD_ENABLED",
  "RECALL_SERVER_STT_ENABLED",
  "RECALL_VOICE_AI_ENABLED",
] as const;
const original = new Map(FLAGS.map((key) => [key, process.env[key]]));
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(aiRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not bind wake-word gate test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(() => {
  for (const key of FLAGS) {
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

describe("Hey Recall server kill switch", () => {
  it("defaults off and rejects wake-word audio before parsing it", async () => {
    for (const key of FLAGS) delete process.env[key];

    const config = await fetch(`${baseUrl}/ai/wakeword/config`);
    expect(await config.json()).toEqual({ enabled: false });

    const transcribe = await fetch(`${baseUrl}/ai/wakeword/transcribe`, {
      method: "POST",
      body: Buffer.from("audio that must not be processed"),
    });
    expect(transcribe.status).toBe(503);
  });

  it("advertises the client feature only when every paid-audio gate is on", async () => {
    for (const key of FLAGS) process.env[key] = "true";
    const enabled = await fetch(`${baseUrl}/ai/wakeword/config`);
    expect(await enabled.json()).toEqual({ enabled: true });

    delete process.env.RECALL_SERVER_STT_ENABLED;
    const blocked = await fetch(`${baseUrl}/ai/wakeword/config`);
    expect(await blocked.json()).toEqual({ enabled: false });
  });
});
