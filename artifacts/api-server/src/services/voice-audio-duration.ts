import { TranscriptionValidationError } from "./voice-first";

const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

function invalidAudio(message = "Could not verify the audio duration"): never {
  throw new TranscriptionValidationError(message);
}

export function assertWakeWordPcmDurationAtMost(
  audio: Buffer,
  maxSeconds: number,
): number {
  if (
    audio.byteLength < 44 ||
    audio.toString("ascii", 0, 4) !== "RIFF" ||
    audio.toString("ascii", 8, 12) !== "WAVE"
  ) {
    invalidAudio();
  }

  let offset = 12;
  let validFormat = false;
  let foundData = false;
  let dataBytes = 0;
  while (offset + 8 <= audio.byteLength) {
    const chunkId = audio.toString("ascii", offset, offset + 4);
    const chunkSize = audio.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + chunkSize;
    if (payloadEnd > audio.byteLength) invalidAudio();

    if (chunkId === "fmt ") {
      if (chunkSize < 16) invalidAudio();
      validFormat =
        audio.readUInt16LE(payloadStart) === 1 &&
        audio.readUInt16LE(payloadStart + 2) === CHANNELS &&
        audio.readUInt32LE(payloadStart + 4) === SAMPLE_RATE &&
        audio.readUInt16LE(payloadStart + 14) === BITS_PER_SAMPLE;
    } else if (chunkId === "data") {
      foundData = true;
      dataBytes += chunkSize;
    }
    offset = payloadEnd + (chunkSize % 2);
  }

  if (!validFormat || !foundData || dataBytes <= 0) invalidAudio();
  const bytesPerSecond = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  const duration = dataBytes / bytesPerSecond;
  if (duration > maxSeconds) {
    invalidAudio(`Recording exceeds the ${maxSeconds}-second limit`);
  }
  return duration;
}
