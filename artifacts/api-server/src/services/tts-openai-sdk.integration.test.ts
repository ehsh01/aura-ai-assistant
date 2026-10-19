import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { speechBodyChunks } from "./tts";

describe("OpenAI SDK chunked TTS integration", () => {
  it("consumes chunked audio returned through the actual SDK client", async () => {
    const fetchStub = vi.fn<typeof fetch>(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2, 3]));
          queueMicrotask(() => {
            controller.enqueue(Uint8Array.from([4, 5, 6]));
            controller.close();
          });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    const client = new OpenAI({
      apiKey: "local-test-key",
      baseURL: "https://openai.invalid/v1",
      fetch: fetchStub,
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
    expect(fetchStub).toHaveBeenCalledOnce();
    expect(String(fetchStub.mock.calls[0]?.[0])).toBe(
      "https://openai.invalid/v1/audio/speech",
    );
  });
});
