/**
 * MediaRecorder-based utterance capture for PWAs / browsers where Web Speech fails.
 * Stops on a trailing pause, a hard duration cap, or an explicit stop();
 * returns a Blob suitable for POST /api/ai/transcribe.
 */
export type RecorderError =
  | "unsupported"
  | "permission-denied"
  | "audio-capture"
  | "too-short"
  | "unknown";

export type RecorderStartResult = { ok: true } | { ok: false; error: RecorderError };

/** Why recording ended without the user tapping stop. */
export type AutoStopReason = "silence" | "max-duration" | "no-speech";

export type SilenceTrackerOptions = {
  /** RMS amplitude (0..1) at or above which a sample counts as speech. */
  speechThreshold?: number;
  /** Trailing quiet required before we treat the utterance as finished. */
  silenceHangoverMs?: number;
  /** Speech required before a pause can end the utterance. */
  minSpeechMs?: number;
  /** Hard cap so a forgotten recording cannot grow unbounded. */
  maxDurationMs?: number;
  /** Give up if the user never actually says anything. */
  noSpeechTimeoutMs?: number;
};

export const SILENCE_DEFAULTS = {
  speechThreshold: 0.015,
  // Shorter than this clips people mid-sentence when they pause to think.
  silenceHangoverMs: 1800,
  minSpeechMs: 300,
  maxDurationMs: 60_000,
  noSpeechTimeoutMs: 8_000,
} as const;

/**
 * Decides when an utterance is over, given a stream of amplitude samples.
 * Pure and clock-injected so the thresholds can be tested without WebAudio.
 */
export class SilenceTracker {
  private readonly opts: Required<SilenceTrackerOptions>;
  private startedAt = 0;
  private lastSampleAt = 0;
  private lastSpeechAt = 0;
  private speechMs = 0;

  constructor(options: SilenceTrackerOptions = {}) {
    this.opts = { ...SILENCE_DEFAULTS, ...options };
  }

  /** Feed one amplitude sample; returns a reason when recording should end. */
  push(level: number, now: number): AutoStopReason | null {
    if (this.startedAt === 0) {
      this.startedAt = now;
      this.lastSampleAt = now;
      this.lastSpeechAt = now;
    }

    const elapsedSinceSample = Math.max(0, now - this.lastSampleAt);
    this.lastSampleAt = now;

    if (level >= this.opts.speechThreshold) {
      this.speechMs += elapsedSinceSample;
      this.lastSpeechAt = now;
    }

    if (now - this.startedAt >= this.opts.maxDurationMs) return "max-duration";

    const heardEnough = this.speechMs >= this.opts.minSpeechMs;
    if (!heardEnough) {
      // Never start the silence clock before the user has spoken, otherwise a
      // slow start would cut them off before they begin.
      return now - this.startedAt >= this.opts.noSpeechTimeoutMs ? "no-speech" : null;
    }

    return now - this.lastSpeechAt >= this.opts.silenceHangoverMs ? "silence" : null;
  }
}

/** RMS amplitude (0..1) of a byte time-domain buffer centered on 128. */
export function rmsFromTimeDomain(buffer: Uint8Array): number {
  if (buffer.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const deviation = ((buffer[i] ?? 128) - 128) / 128;
    sum += deviation * deviation;
  }
  return Math.sqrt(sum / buffer.length);
}

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

const SAMPLE_INTERVAL_MS = 100;

export type RecorderStartOptions = {
  /** Fired when the utterance ends on its own. Not called for manual stop(). */
  onAutoStop?: (reason: AutoStopReason) => void;
  silence?: SilenceTrackerOptions;
};

export class UtteranceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: BlobPart[] = [];
  private mimeType = "audio/webm";
  private startedAt = 0;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private settled = false;

  get recording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  async start(options: RecorderStartOptions = {}): Promise<RecorderStartResult> {
    if (!canUseMediaRecorder()) return { ok: false, error: "unsupported" };
    this.stopTracks();
    this.chunks = [];
    this.settled = false;

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
    this.startSilenceWatch(options);
    return { ok: true };
  }

  private startSilenceWatch(options: RecorderStartOptions): void {
    const onAutoStop = options.onAutoStop;
    if (!onAutoStop || !this.stream) return;

    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // No WebAudio: fall back to manual stop only.

    try {
      const context = new Ctor();
      void context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(this.stream).connect(analyser);
      this.audioContext = context;
      this.analyser = analyser;
    } catch {
      this.teardownAudioGraph();
      return;
    }

    const tracker = new SilenceTracker(options.silence);
    const buffer = new Uint8Array(this.analyser.fftSize);
    this.sampleTimer = setInterval(() => {
      const analyser = this.analyser;
      if (!analyser || this.settled) return;
      analyser.getByteTimeDomainData(buffer);
      const reason = tracker.push(rmsFromTimeDomain(buffer), Date.now());
      if (!reason) return;
      this.settled = true;
      this.clearSilenceWatch();
      onAutoStop(reason);
    }, SAMPLE_INTERVAL_MS);
  }

  private clearSilenceWatch(): void {
    if (this.sampleTimer !== null) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
  }

  private teardownAudioGraph(): void {
    this.clearSilenceWatch();
    this.analyser = null;
    const context = this.audioContext;
    this.audioContext = null;
    if (context) void context.close().catch(() => {});
  }

  /** Stop and return the recorded blob (or null if too short / empty). */
  stop(): Promise<{ blob: Blob; mimeType: string; durationMs: number } | { error: RecorderError }> {
    this.settled = true;
    this.teardownAudioGraph();
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
    this.settled = true;
    this.teardownAudioGraph();
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
