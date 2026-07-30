/**
 * Voice First boundary — shared types.
 * Conceptual CaptureInput / UnderstandingResult mapped onto existing Recall entities.
 */
export type VoiceCaptureSource =
  | "typed"
  | "voice_browser_stt"
  | "voice_server_stt"
  | "ask"
  | "share"
  | "extension";

export type VoicePipelineStatus =
  | "received"
  | "transcribing"
  | "understanding"
  | "awaiting_confirmation"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

export type VoiceFirstIntent = "create_task" | "create_reminder" | "unknown";

/** Product decision: “morning” resolves to 09:00 local when no clock time is given. */
export const VOICE_FIRST_MORNING_HOUR = 9;
export const VOICE_FIRST_EVENING_HOUR = 17;

export type TemporalResolution = {
  /** ISO datetime or YYYY-MM-DD when only a date is known. */
  dueAt: string | null;
  /** How the time was chosen. */
  basis: "explicit_clock" | "morning_default" | "evening_default" | "date_only" | "unresolved";
  explanation: string | null;
};

export type VoiceCaptureInput = {
  userId: string;
  text: string;
  source: VoiceCaptureSource;
  sessionId?: string | null;
  timezone?: string | null;
  idempotencyKey?: string | null;
  clientTimestamp?: string | null;
  metadata?: Record<string, unknown>;
};
