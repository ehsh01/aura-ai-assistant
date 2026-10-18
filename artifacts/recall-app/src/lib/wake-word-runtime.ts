import { OpenWakeWord, configureOrt } from "openwakeword-web";
import { Microphone } from "openwakeword-web/microphone";
import { SilenceTracker } from "@/lib/utterance-recorder";
import type { WakeCaptureResult } from "@/lib/wake-word-activation";
import { encodePcmWav, rmsInt16 } from "@/lib/wake-word-pcm";

const MODEL_BASE = `${import.meta.env.BASE_URL}wakeword/`;
export const HEY_RECALL_THRESHOLD = 0.97;

export type WakeWordRuntime = {
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  capture: (signal?: AbortSignal) => Promise<WakeCaptureResult>;
  dispose: () => Promise<void>;
};

export async function startWakeWordRuntime(options: {
  onDetection: (score: number) => void;
  signal?: AbortSignal;
}): Promise<WakeWordRuntime> {
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  configureOrt({ numThreads: 1 });
  const detector = await OpenWakeWord.create({
    melspectrogramUrl: `${MODEL_BASE}melspectrogram.onnx`,
    embeddingUrl: `${MODEL_BASE}embedding_model.onnx`,
    wakewordModels: [
      {
        name: "hey_recall",
        url: `${MODEL_BASE}hey_recall.onnx`,
        inputFrames: 16,
      },
    ],
    threshold: HEY_RECALL_THRESHOLD,
    onDetection: ({ score }) => options.onDetection(score),
  });
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  let microphone: Microphone | null = null;
  let disposed = false;
  let detecting = false;
  let inference = Promise.resolve();
  let captureFrame: ((frame: Int16Array) => void) | null = null;
  let cancelCapture: (() => void) | null = null;

  const resume = async () => {
    if (disposed || options.signal?.aborted) return;
    await inference;
    await detector.reset();
    if (!microphone) {
      const next = new Microphone(
        (frame) => {
          captureFrame?.(frame);
          if (!detecting) return;
          inference = inference
            .then(() => detector.predict(frame))
            .then(() => undefined)
            .catch(() => undefined);
        },
        { workletUrl: `${MODEL_BASE}mic-worklet.js` },
      );
      if (options.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      try {
        await next.start();
        if (disposed || options.signal?.aborted) {
          await next.stop();
          if (options.signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          return;
        }
        microphone = next;
      } catch (error) {
        await next.stop().catch(() => undefined);
        throw error;
      }
    }
    detecting = true;
  };

  const pause = async () => {
    detecting = false;
  };

  const capture = (signal?: AbortSignal): Promise<WakeCaptureResult> =>
    new Promise((resolve) => {
      if (captureFrame || signal?.aborted) {
        resolve({ ok: false, reason: "capture-error" });
        return;
      }
      const frames: Int16Array[] = [];
      const tracker = new SilenceTracker({
        noSpeechTimeoutMs: 7_000,
        silenceHangoverMs: 1_500,
        maxDurationMs: 59_000,
      });
      let elapsedMs = 0;
      let settled = false;

      const settle = (result: WakeCaptureResult) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        captureFrame = null;
        cancelCapture = null;
        resolve(result);
      };
      const abort = () => settle({ ok: false, reason: "capture-error" });
      cancelCapture = abort;
      signal?.addEventListener("abort", abort, { once: true });
      captureFrame = (frame) => {
        if (settled) return;
        const copy = frame.slice();
        frames.push(copy);
        elapsedMs += (copy.length / 16_000) * 1_000;
        const reason = tracker.push(rmsInt16(copy), elapsedMs);
        if (!reason) return;
        if (reason === "no-speech") {
          settle({ ok: false, reason: "no-speech" });
          return;
        }
        settle({
          ok: true,
          blob: encodePcmWav(frames),
          mimeType: "audio/wav",
        });
      };
    });

  await resume();
  return {
    pause,
    resume,
    capture,
    dispose: async () => {
      disposed = true;
      detecting = false;
      cancelCapture?.();
      const current = microphone;
      microphone = null;
      await current?.stop().catch(() => undefined);
      await inference;
    },
  };
}
