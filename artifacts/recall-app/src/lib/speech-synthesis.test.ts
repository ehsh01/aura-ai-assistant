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

  it("keeps a blob fallback when MediaSource streaming is unavailable", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const browserSpeak = vi.fn();
    class FakeAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src: string;
      pause = vi.fn();
      play = play;
      constructor(src: string) {
        this.src = src;
      }
    }
    const blob = new Blob(["mp3"], { type: "audio/mpeg" });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
      blob: vi.fn().mockResolvedValue(blob),
    });
    vi.stubGlobal("window", {
      speechSynthesis: {
        cancel: vi.fn(),
        speak: browserSpeak,
        speaking: false,
        getVoices: () => [],
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("MediaSource", undefined);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:tts"),
      revokeObjectURL: vi.fn(),
    });

    await expect(speakText("Grounded answer", { premium: true })).resolves.toBe(
      true,
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/ai/tts",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(play).toHaveBeenCalledOnce();
    expect(browserSpeak).not.toHaveBeenCalled();
  });

  it.each(["disabled", "daily_limit"] as const)(
    "uses browser speech only after the server reports %s",
    async (reason) => {
      const browserSpeak = vi.fn();
      class FakeUtterance {
        rate = 1;
        pitch = 1;
        voice: SpeechSynthesisVoice | null = null;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(public text: string) {}
      }
      vi.stubGlobal("window", {
        SpeechSynthesisUtterance: FakeUtterance,
        speechSynthesis: {
          cancel: vi.fn(),
          speak: browserSpeak,
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
        },
      });
      vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: reason === "daily_limit" ? 429 : 503,
          json: vi.fn().mockResolvedValue({ reason }),
        }),
      );

      await expect(
        speakText("Fallback answer", { premium: true }),
      ).resolves.toBe(true);
      expect(browserSpeak).toHaveBeenCalledOnce();
    },
  );

  it("does not race browser speech after an ordinary server failure", async () => {
    const browserSpeak = vi.fn();
    vi.stubGlobal("window", {
      speechSynthesis: {
        cancel: vi.fn(),
        speak: browserSpeak,
        speaking: false,
        getVoices: () => [],
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: vi.fn().mockResolvedValue({ message: "upstream failed" }),
      }),
    );

    await expect(
      speakText("No generic voice", { premium: true }),
    ).resolves.toBe(false);
    expect(browserSpeak).not.toHaveBeenCalled();
  });
});
