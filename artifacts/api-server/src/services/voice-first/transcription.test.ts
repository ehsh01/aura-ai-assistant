import { afterEach, describe, expect, it } from "vitest";
import type { TranscriptionProvider, TranscriptionRequest, TranscriptionResult } from "./providers/transcription";
import {
  TranscriptionUnavailableError,
  TranscriptionValidationError,
} from "./providers/transcription";
import {
  MAX_VOICE_AUDIO_BYTES,
  OpenAiWhisperTranscriptionProvider,
} from "./providers/openai-whisper";

const originalServerStt = process.env.RECALL_SERVER_STT_ENABLED;
afterEach(() => {
  if (originalServerStt === undefined) delete process.env.RECALL_SERVER_STT_ENABLED;
  else process.env.RECALL_SERVER_STT_ENABLED = originalServerStt;
});

/** Fake provider for contract tests — no paid API calls. */
class FakeTranscriptionProvider implements TranscriptionProvider {
  readonly name = "fake";
  lastInput: TranscriptionRequest | null = null;

  async transcribe(input: TranscriptionRequest): Promise<TranscriptionResult> {
    this.lastInput = input;
    if (!input.audio.length) throw new TranscriptionValidationError("Audio is required");
    if (input.audio.length > MAX_VOICE_AUDIO_BYTES) {
      throw new TranscriptionValidationError("too large");
    }
    return {
      text: "Remind me tomorrow morning to call John",
      provider: this.name,
      model: "fake-1",
      durationMs: 12,
      language: "en",
    };
  }
}

describe("TranscriptionProvider contract (fake)", () => {
  it("returns a finalized transcript without calling an external model", async () => {
    const provider = new FakeTranscriptionProvider();
    const result = await provider.transcribe({
      audio: Buffer.from("fake-audio-bytes"),
      mimeType: "audio/webm",
      locale: "en-US",
    });
    expect(result.text).toMatch(/John/);
    expect(result.provider).toBe("fake");
    expect(provider.lastInput?.mimeType).toBe("audio/webm");
  });

  it("rejects empty audio", async () => {
    const provider = new FakeTranscriptionProvider();
    await expect(
      provider.transcribe({ audio: Buffer.alloc(0), mimeType: "audio/webm" }),
    ).rejects.toBeInstanceOf(TranscriptionValidationError);
  });
});

describe("OpenAI Whisper kill switch", () => {
  it("returns unavailable only when server STT is explicitly disabled", async () => {
    process.env.RECALL_SERVER_STT_ENABLED = "false";
    const provider = new OpenAiWhisperTranscriptionProvider();
    await expect(
      provider.transcribe({
        audio: Buffer.from("fake-audio"),
        mimeType: "audio/webm",
      }),
    ).rejects.toBeInstanceOf(TranscriptionUnavailableError);
  });
});
