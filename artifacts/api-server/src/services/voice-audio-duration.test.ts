import { describe, expect, it } from "vitest";
import { TranscriptionValidationError } from "./voice-first";
import { assertWakeWordPcmDurationAtMost } from "./voice-audio-duration";

function silentWav(seconds: number, sampleRate = 16_000): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const dataSize = Math.round(seconds * sampleRate * channels * 2);
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * 2, 28);
  wav.writeUInt16LE(channels * 2, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}

describe("wake-word audio duration validation", () => {
  it("accepts an utterance within the server limit", () => {
    expect(assertWakeWordPcmDurationAtMost(silentWav(2), 60)).toBeCloseTo(2);
  });

  it("rejects byte-counted overlong audio", () => {
    expect(() => assertWakeWordPcmDurationAtMost(silentWav(61), 60)).toThrow(
      "60-second limit",
    );
  });

  it("fails closed when duration cannot be verified", () => {
    expect(() =>
      assertWakeWordPcmDurationAtMost(Buffer.from("not audio"), 60),
    ).toThrow(TranscriptionValidationError);
    expect(() =>
      assertWakeWordPcmDurationAtMost(silentWav(2, 48_000), 60),
    ).toThrow(TranscriptionValidationError);
  });
});
