import { afterEach, describe, expect, it, vi } from "vitest";
import { speakText, stopSpeaking } from "./speech-synthesis";

afterEach(() => {
  stopSpeaking();
  vi.unstubAllGlobals();
});

describe("speakText paid-audio boundary", () => {
  it("ignores the legacy premium preference unless premium is passed explicitly", async () => {
    const speak = vi.fn();
    const fetchSpy = vi.fn();
    class FakeUtterance {
      rate = 1;
      pitch = 1;
      voice: SpeechSynthesisVoice | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    const speechSynthesis = {
      cancel: vi.fn(),
      speak,
      speaking: false,
      getVoices: () => [
        {
          name: "Local English",
          lang: "en-US",
          localService: true,
        } as SpeechSynthesisVoice,
      ],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => (key === "recall.premiumTts" ? "1" : null),
      },
      speechSynthesis,
      SpeechSynthesisUtterance: FakeUtterance,
    });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    vi.stubGlobal("fetch", fetchSpy);

    await expect(speakText("Recall answer")).resolves.toBe(true);
    expect(speak).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
