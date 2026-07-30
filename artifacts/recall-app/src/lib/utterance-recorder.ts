/**
 * MediaRecorder-based utterance capture for PWAs / browsers where Web Speech fails.
 * Records until stop(); returns a Blob suitable for POST /api/ai/transcribe.
 */
export type RecorderError =
  | "unsupported"
  | "permission-denied"
  | "audio-capture"
  | "too-short"
  | "unknown";

export type RecorderStartResult = { ok: true } | { ok: false; error: RecorderError };

const PREFERRED_MIME = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export function pickRecorderMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of PREFERRED_MIME) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

export function canUseMediaRecorder(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined" &&
    pickRecorderMimeType() !== null
  );
}

export class UtteranceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: BlobPart[] = [];
  private mimeType = "audio/webm";
  private startedAt = 0;

  get recording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  async start(): Promise<RecorderStartResult> {
    if (!canUseMediaRecorder()) return { ok: false, error: "unsupported" };
    this.stopTracks();
    this.chunks = [];

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        return { ok: false, error: "permission-denied" };
      }
      if (name === "NotFoundError" || name === "NotReadableError") {
        return { ok: false, error: "audio-capture" };
      }
      return { ok: false, error: "unknown" };
    }

    const mime = pickRecorderMimeType() ?? "";
    this.mimeType = mime || "audio/webm";
    try {
      this.mediaRecorder = mime
        ? new MediaRecorder(this.stream, { mimeType: mime })
        : new MediaRecorder(this.stream);
    } catch {
      this.stopTracks();
      return { ok: false, error: "unsupported" };
    }

    this.mediaRecorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) this.chunks.push(ev.data);
    };
    this.startedAt = Date.now();
    this.mediaRecorder.start(250);
    return { ok: true };
  }

  /** Stop and return the recorded blob (or null if too short / empty). */
  stop(): Promise<{ blob: Blob; mimeType: string; durationMs: number } | { error: RecorderError }> {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === "inactive") {
      this.stopTracks();
      return Promise.resolve({ error: "too-short" });
    }

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const durationMs = Date.now() - this.startedAt;
        const mimeType = recorder.mimeType || this.mimeType;
        const blob = new Blob(this.chunks, { type: mimeType });
        this.stopTracks();
        this.mediaRecorder = null;
        this.chunks = [];
        if (blob.size < 256 || durationMs < 400) {
          resolve({ error: "too-short" });
          return;
        }
        resolve({ blob, mimeType, durationMs });
      };
      try {
        recorder.stop();
      } catch {
        this.stopTracks();
        resolve({ error: "unknown" });
      }
    });
  }

  cancel(): void {
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
        this.mediaRecorder.onstop = null;
        this.mediaRecorder.stop();
      }
    } catch {
      // ignore
    }
    this.stopTracks();
    this.mediaRecorder = null;
    this.chunks = [];
  }

  private stopTracks(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }
}
