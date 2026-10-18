import { afterEach, describe, expect, it, vi } from "vitest";
import { pickSpeechMode } from "./use-speech-input";
import { canProcessSpeechLocally } from "@/lib/speech-support";

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

describe("Chrome on-device recognition", () => {
  it("enables local processing only when the language pack is available", async () => {
    class AvailableRecognition {
      static available = vi.fn().mockResolvedValue("available");
    }
    class DownloadableRecognition {
      static available = vi.fn().mockResolvedValue("downloadable");
    }

    await expect(
      canProcessSpeechLocally(
        AvailableRecognition as unknown as Parameters<
          typeof canProcessSpeechLocally
        >[0],
        "en-US",
      ),
    ).resolves.toBe(true);
    await expect(
      canProcessSpeechLocally(
        DownloadableRecognition as unknown as Parameters<
          typeof canProcessSpeechLocally
        >[0],
        "en-US",
      ),
    ).resolves.toBe(false);
  });
});
