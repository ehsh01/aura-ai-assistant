import { describe, expect, it } from "vitest";
import {
  rmsFromTimeDomain,
  SILENCE_DEFAULTS,
  SilenceTracker,
  type AutoStopReason,
} from "./utterance-recorder";

const TICK = 100;

/**
 * Feeds a level for a duration and returns the first auto-stop reason, or null.
 * Mirrors the 100ms sampling interval used by the recorder.
 */
function feed(
  tracker: SilenceTracker,
  segments: { level: number; ms: number }[],
  startAt = 1_000,
): { reason: AutoStopReason | null; at: number } {
  let now = startAt;
  for (const segment of segments) {
    for (let elapsed = 0; elapsed < segment.ms; elapsed += TICK) {
      now += TICK;
      const reason = tracker.push(segment.level, now);
      if (reason) return { reason, at: now - startAt };
    }
  }
  return { reason: null, at: now - startAt };
}

const SPEECH = 0.2;
const QUIET = 0.001;

describe("SilenceTracker", () => {
  it("ends the utterance after a trailing pause", () => {
    const tracker = new SilenceTracker();
    const { reason } = feed(tracker, [
      { level: SPEECH, ms: 2_000 },
      { level: QUIET, ms: 3_000 },
    ]);
    expect(reason).toBe("silence");
  });

  it("does not stop on a short pause mid-sentence", () => {
    const tracker = new SilenceTracker();
    const { reason } = feed(tracker, [
      { level: SPEECH, ms: 1_000 },
      // Thinking pause, comfortably under the hangover window.
      { level: QUIET, ms: SILENCE_DEFAULTS.silenceHangoverMs - 500 },
      { level: SPEECH, ms: 1_000 },
    ]);
    expect(reason).toBeNull();
  });

  it("keeps listening while the user is still talking", () => {
    const tracker = new SilenceTracker();
    const { reason } = feed(tracker, [{ level: SPEECH, ms: 20_000 }]);
    expect(reason).toBeNull();
  });

  it("waits for speech before arming the silence timer", () => {
    const tracker = new SilenceTracker();
    // Quiet for longer than the hangover, but the user never started: a slow
    // start must not be mistaken for a finished utterance.
    const { reason } = feed(tracker, [
      { level: QUIET, ms: SILENCE_DEFAULTS.silenceHangoverMs + 1_000 },
    ]);
    expect(reason).toBeNull();
  });

  it("gives up when no speech ever arrives", () => {
    const tracker = new SilenceTracker();
    const { reason, at } = feed(tracker, [{ level: QUIET, ms: 30_000 }]);
    expect(reason).toBe("no-speech");
    expect(at).toBeGreaterThanOrEqual(SILENCE_DEFAULTS.noSpeechTimeoutMs);
  });

  it("caps a forgotten recording at the max duration", () => {
    const tracker = new SilenceTracker();
    // Continuous speech would otherwise never trigger the silence path.
    const { reason, at } = feed(tracker, [{ level: SPEECH, ms: 120_000 }]);
    expect(reason).toBe("max-duration");
    expect(at).toBeLessThanOrEqual(SILENCE_DEFAULTS.maxDurationMs + TICK);
  });

  it("ignores a brief noise blip as speech", () => {
    const tracker = new SilenceTracker();
    const { reason } = feed(tracker, [
      // Under minSpeechMs, so this must not arm the silence timer.
      { level: SPEECH, ms: 100 },
      { level: QUIET, ms: 3_000 },
    ]);
    expect(reason).toBeNull();
  });

  it("honors overridden thresholds", () => {
    const tracker = new SilenceTracker({ silenceHangoverMs: 400, minSpeechMs: 100 });
    const { reason } = feed(tracker, [
      { level: SPEECH, ms: 500 },
      { level: QUIET, ms: 800 },
    ]);
    expect(reason).toBe("silence");
  });
});

describe("rmsFromTimeDomain", () => {
  it("reports silence for a flat centered signal", () => {
    expect(rmsFromTimeDomain(new Uint8Array(256).fill(128))).toBe(0);
  });

  it("reports a level above the speech threshold for a loud signal", () => {
    const buffer = new Uint8Array(256);
    for (let i = 0; i < buffer.length; i++) buffer[i] = i % 2 === 0 ? 200 : 56;
    expect(rmsFromTimeDomain(buffer)).toBeGreaterThan(SILENCE_DEFAULTS.speechThreshold);
  });

  it("treats room tone as below the speech threshold", () => {
    const buffer = new Uint8Array(256);
    for (let i = 0; i < buffer.length; i++) buffer[i] = i % 2 === 0 ? 129 : 127;
    expect(rmsFromTimeDomain(buffer)).toBeLessThan(SILENCE_DEFAULTS.speechThreshold);
  });

  it("handles an empty buffer", () => {
    expect(rmsFromTimeDomain(new Uint8Array(0))).toBe(0);
  });
});
