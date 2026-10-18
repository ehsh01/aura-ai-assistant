import { describe, expect, it, vi } from "vitest";
import { createWakeActivationHandler } from "./wake-word-activation";

describe("wake-word privacy boundary", () => {
  it("makes no capture or network call before a wake detection", async () => {
    const captureUtterance = vi.fn().mockResolvedValue({
      ok: true,
      blob: new Blob(["audio"], { type: "audio/webm" }),
      mimeType: "audio/webm",
    });
    const transcribe = vi.fn().mockResolvedValue("what is due today");
    const publish = vi.fn();

    const onWakeDetected = createWakeActivationHandler({
      pauseWakeWord: vi.fn().mockResolvedValue(undefined),
      captureUtterance,
      transcribe,
      publish,
      resumeWakeWord: vi.fn().mockResolvedValue(undefined),
    });

    await Promise.resolve();
    expect(captureUtterance).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();

    await onWakeDetected();
    expect(captureUtterance).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith("what is due today");
  });

  it("does not transcribe when no post-wake speech was captured", async () => {
    const transcribe = vi.fn();
    const onWakeDetected = createWakeActivationHandler({
      pauseWakeWord: vi.fn().mockResolvedValue(undefined),
      captureUtterance: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "no-speech" }),
      transcribe,
      publish: vi.fn(),
      resumeWakeWord: vi.fn().mockResolvedValue(undefined),
    });

    await onWakeDetected();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("does not upload when the user turns listening off during capture", async () => {
    const abort = new AbortController();
    const transcribe = vi.fn();
    const onWakeDetected = createWakeActivationHandler({
      pauseWakeWord: vi.fn().mockResolvedValue(undefined),
      captureUtterance: vi.fn().mockImplementation(async () => {
        abort.abort();
        return {
          ok: true,
          blob: new Blob(["audio"], { type: "audio/webm" }),
          mimeType: "audio/webm",
        };
      }),
      transcribe,
      publish: vi.fn(),
      resumeWakeWord: vi.fn().mockResolvedValue(undefined),
      signal: abort.signal,
    });

    await onWakeDetected();
    expect(transcribe).not.toHaveBeenCalled();
  });
});
