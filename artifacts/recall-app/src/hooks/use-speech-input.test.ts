import { afterEach, describe, expect, it, vi } from "vitest";
import { pickSpeechMode } from "./use-speech-input";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("paid server transcription selection", () => {
  it("uses no fallback by default and selects server mode only after opt-in", () => {
    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }
    }
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn() },
    });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    expect(pickSpeechMode(false)).toBe("none");
    expect(pickSpeechMode(true)).toBe("server");
  });
});
