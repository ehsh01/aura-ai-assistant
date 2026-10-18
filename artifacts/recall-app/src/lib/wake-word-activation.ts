export type WakeCaptureResult =
  | { ok: true; blob: Blob; mimeType: string }
  | { ok: false; reason: "no-speech" | "capture-error" };

export type WakeActivationDependencies = {
  pauseWakeWord: () => Promise<void>;
  captureUtterance: (signal?: AbortSignal) => Promise<WakeCaptureResult>;
  transcribe: (blob: Blob, mimeType: string) => Promise<string>;
  publish: (transcript: string) => void;
  resumeWakeWord: () => Promise<void>;
  onState?: (
    state: "recording" | "transcribing" | "listening" | "error",
  ) => void;
  signal?: AbortSignal;
};

/**
 * Builds the only post-wake network path. Constructing this handler does
 * nothing; capture and transcription begin only when the detector invokes it.
 */
export function createWakeActivationHandler(
  dependencies: WakeActivationDependencies,
): () => Promise<void> {
  let active = false;

  return async () => {
    if (active || dependencies.signal?.aborted) return;
    active = true;
    try {
      await dependencies.pauseWakeWord();
      if (dependencies.signal?.aborted) return;
      dependencies.onState?.("recording");
      const capture = await dependencies.captureUtterance(dependencies.signal);
      if (!capture.ok) {
        if (!dependencies.signal?.aborted) {
          dependencies.onState?.(
            capture.reason === "no-speech" ? "listening" : "error",
          );
        }
        return;
      }

      if (dependencies.signal?.aborted) return;
      dependencies.onState?.("transcribing");
      const transcript = (
        await dependencies.transcribe(capture.blob, capture.mimeType)
      ).trim();
      if (!dependencies.signal?.aborted) {
        if (transcript) dependencies.publish(transcript);
        dependencies.onState?.("listening");
      }
    } catch {
      dependencies.onState?.("error");
    } finally {
      active = false;
      if (!dependencies.signal?.aborted) {
        await dependencies.resumeWakeWord().catch(() => undefined);
      }
    }
  };
}
