/**
 * Transcription provider boundary — domain logic must not import OpenAI here.
 */
export type TranscriptionRequest = {
  /** Raw audio bytes. */
  audio: Buffer;
  /** MIME type from the client (e.g. audio/webm). */
  mimeType: string;
  /** Original filename hint for the provider. */
  filename?: string;
  /** BCP-47 locale hint. */
  locale?: string;
};

export type TranscriptionResult = {
  text: string;
  provider: string;
  model: string;
  durationMs: number;
  /** Language detected/used when available. */
  language?: string | null;
};

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(input: TranscriptionRequest): Promise<TranscriptionResult>;
}

export class TranscriptionUnavailableError extends Error {
  readonly status = 503;
  constructor(message = "Speech transcription is not configured") {
    super(message);
    this.name = "TranscriptionUnavailableError";
  }
}

export class TranscriptionValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionValidationError";
  }
}
