import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { speechBodyChunks } from "./tts";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/audio/speech") {
      res.writeHead(404).end();
      return;
    }
    req.resume();
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Transfer-Encoding": "chunked",
    });
    res.write(Buffer.from([1, 2, 3]));
    setTimeout(() => res.end(Buffer.from([4, 5, 6])), 15);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not bind mock OpenAI server");
  }
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("OpenAI SDK chunked TTS integration", () => {
  it("consumes chunked audio returned through the actual SDK client", async () => {
    const client = new OpenAI({
      apiKey: "local-test-key",
      baseURL: baseUrl,
      maxRetries: 0,
    });
    const response = await client.audio.speech.create({
      model: "tts-1",
      voice: "onyx",
      input: "Integration test",
      response_format: "mp3",
    });

    const bytes: number[] = [];
    for await (const chunk of speechBodyChunks(response.body)) {
      bytes.push(...chunk);
    }

    expect(bytes).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
