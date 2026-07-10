import OpenAI from "openai";

export const OPENAI_TTS_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;

export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];

function isOpenAiTtsVoice(value: string): value is OpenAiTtsVoice {
  return (OPENAI_TTS_VOICES as readonly string[]).includes(value);
}

/**
 * Synthesize speech with OpenAI TTS.
 * Defaults: model tts-1 (fast/cheap), voice nova.
 * Override with OPENAI_TTS_MODEL / OPENAI_TTS_VOICE.
 */
export async function synthesizeSpeech(
  text: string,
  voice?: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not configured") as Error & { status?: number };
    err.status = 503;
    throw err;
  }

  const cleaned = text.replace(/\s+/g, " ").trim().slice(0, 4096);
  if (!cleaned) {
    const err = new Error("Text is required") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const model = process.env.OPENAI_TTS_MODEL?.trim() || "tts-1";
  const envVoice = process.env.OPENAI_TTS_VOICE?.trim() || "nova";
  const chosen = voice && isOpenAiTtsVoice(voice) ? voice : isOpenAiTtsVoice(envVoice) ? envVoice : "nova";

  const client = new OpenAI({ apiKey });
  const response = await client.audio.speech.create({
    model,
    voice: chosen,
    input: cleaned,
    response_format: "mp3",
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType: "audio/mpeg" };
}
