/**
 * OpenAI Whisper transcription adapter.
 * Audio is never logged — only byte length and latency.
 */
import OpenAI, { toFile } from "openai";
import { isEnabled } from "../../../lib/feature-flags";
import { recordAiUsage } from "../../ai-usage";
import {
  TranscriptionUnavailableError,
  TranscriptionValidationError,
  type TranscriptionProvider,
  type TranscriptionRequest,
  type TranscriptionResult,
} from "./transcription";

const ALLOWED_MIME = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  // Some browsers label MediaRecorder output with a video container even for
  // audio-only tracks (Chrome → webm, iOS Safari → mp4).
  "video/webm",
  "video/mp4",
]);

/** Max upload for a single utterance (Whisper allows 25MB; we stay conservative). */
export const MAX_VOICE_AUDIO_BYTES = 5 * 1024 * 1024;

function extensionForMime(mime: string): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  if (base.includes("webm")) return "webm";
  if (base.includes("ogg")) return "ogg";
  if (base.includes("mpeg") || base.includes("mp3")) return "mp3";
  if (base.includes("wav")) return "wav";
  if (base.includes("mp4") || base.includes("m4a")) return "m4a";
  return "webm";
}

export class OpenAiWhisperTranscriptionProvider implements TranscriptionProvider {
  readonly name = "openai-whisper";

  async transcribe(input: TranscriptionRequest): Promise<TranscriptionResult> {
    if (!isEnabled("RECALL_SERVER_STT_ENABLED")) {
      throw new TranscriptionUnavailableError("Server speech transcription is disabled");
    }
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new TranscriptionUnavailableError();

    if (!input.audio?.length) {
      throw new TranscriptionValidationError("Audio is required");
    }
    if (input.audio.length > MAX_VOICE_AUDIO_BYTES) {
      throw new TranscriptionValidationError(
        `Audio exceeds the ${Math.round(MAX_VOICE_AUDIO_BYTES / (1024 * 1024))}MB limit`,
      );
    }

    const mime = (input.mimeType || "audio/webm").toLowerCase();
    const mimeBase = mime.split(";")[0]!.trim();
    if (
      !ALLOWED_MIME.has(mime) &&
      !ALLOWED_MIME.has(mimeBase) &&
      !mimeBase.startsWith("audio/")
    ) {
      throw new TranscriptionValidationError(`Unsupported audio type: ${mimeBase}`);
    }

    // Whisper infers the container from the filename extension, so a
    // video/* label must still be sent with an audio extension.
    const uploadType = mimeBase.startsWith("video/")
      ? mimeBase.includes("webm")
        ? "audio/webm"
        : "audio/mp4"
      : mimeBase;

    const model = process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || "whisper-1";
    const ext = extensionForMime(mime);
    const filename = input.filename?.replace(/[^\w.-]/g, "_") || `utterance.${ext}`;
    const started = Date.now();

    const client = new OpenAI({ apiKey });
    const file = await toFile(input.audio, filename, { type: uploadType });
    const result = await client.audio.transcriptions.create({
      file,
      model,
      language: input.locale?.slice(0, 2) || undefined,
    });

    const text = (result.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) {
      throw new TranscriptionValidationError("No speech detected in the recording");
    }
    await recordAiUsage({
      userId: input.userId,
      feature: "transcribe",
      model,
    });

    return {
      text,
      provider: this.name,
      model,
      durationMs: Date.now() - started,
      language: input.locale?.slice(0, 2) ?? null,
    };
  }
}

let cached: TranscriptionProvider | null = null;

export function getTranscriptionProvider(): TranscriptionProvider {
  if (!cached) cached = new OpenAiWhisperTranscriptionProvider();
  return cached;
}

/** Test hook. */
export function setTranscriptionProviderForTests(provider: TranscriptionProvider | null): void {
  cached = provider;
}
