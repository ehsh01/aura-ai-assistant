import { describe, expect, it } from "vitest";
import {
  createVoiceSessionState,
  shouldBargeIn,
  voiceSessionReducer,
} from "./voice-conversation-state";

describe("voice conversation state", () => {
  it("barge-in leaves speaking immediately and resets the listening deadline", () => {
    const started = voiceSessionReducer(createVoiceSessionState(8_000), {
      type: "start",
      now: 1_000,
    });
    const speaking = voiceSessionReducer(started, {
      type: "speaking-started",
    });

    expect(shouldBargeIn(speaking)).toBe(true);
    expect(
      voiceSessionReducer(speaking, {
        type: "speech-started",
        now: 3_000,
      }),
    ).toMatchObject({
      phase: "listening",
      silenceDeadlineAt: 11_000,
    });
  });

  it("ends only when the configured silence deadline is reached", () => {
    const listening = voiceSessionReducer(createVoiceSessionState(8_000), {
      type: "start",
      now: 5_000,
    });

    expect(
      voiceSessionReducer(listening, {
        type: "silence-timeout",
        now: 12_999,
      }),
    ).toEqual(listening);
    expect(
      voiceSessionReducer(listening, {
        type: "silence-timeout",
        now: 13_000,
      }),
    ).toMatchObject({
      phase: "ended",
      silenceDeadlineAt: null,
      message: "Session ended after 8 seconds of silence.",
    });
  });

  it("does not apply silence timeout while thinking or speaking", () => {
    const listening = voiceSessionReducer(createVoiceSessionState(), {
      type: "start",
      now: 0,
    });
    const thinking = voiceSessionReducer(listening, { type: "turn-started" });
    const speaking = voiceSessionReducer(thinking, {
      type: "speaking-started",
    });

    expect(
      voiceSessionReducer(thinking, {
        type: "silence-timeout",
        now: 30_000,
      }),
    ).toEqual(thinking);
    expect(
      voiceSessionReducer(speaking, {
        type: "silence-timeout",
        now: 30_000,
      }),
    ).toEqual(speaking);
  });
});
