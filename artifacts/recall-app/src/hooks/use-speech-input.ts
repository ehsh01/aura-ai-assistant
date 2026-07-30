import { useCallback, useEffect, useRef, useState } from "react";
import {
  ensureMicPermission,
  getSpeechBlockReason,
  getSpeechRecognitionCtor,
  isIosDevice,
  mapRecognitionError,
  type SpeechInputError,
} from "@/lib/speech-support";
import { canUseMediaRecorder, UtteranceRecorder } from "@/lib/utterance-recorder";
import { transcribeUtterance } from "@/lib/recall-api";

type StartResult = { ok: true } | { ok: false; error: SpeechInputError };

function collectTranscript(event: SpeechRecognitionEvent): string {
  const parts: string[] = [];
  for (let i = 0; i < event.results.length; i++) {
    const result = event.results[i];
    const text = result[0]?.transcript?.trim();
    if (!text) continue;
    if (result.isFinal) {
      parts.push(text);
    }
  }
  if (parts.length > 0) return parts.join(" ").trim();

  const last = event.results[event.results.length - 1];
  return last?.[0]?.transcript?.trim() ?? "";
}

export type SpeechMode = "browser" | "server" | "none";

type UseSpeechInputOptions = {
  onError?: (error: SpeechInputError) => void;
  /** Called while server transcription is in flight. */
  onTranscribingChange?: (busy: boolean) => void;
};

function pickMode(): SpeechMode {
  const block = getSpeechBlockReason();
  // Prefer browser STT when available (fast, free).
  if (block === null && getSpeechRecognitionCtor()) return "browser";
  // iOS PWA / unsupported Web Speech → MediaRecorder + server Whisper when possible.
  if (canUseMediaRecorder()) return "server";
  return "none";
}

export function useSpeechInput(onFinal: (text: string) => void, options: UseSpeechInputOptions = {}) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [mode, setMode] = useState<SpeechMode>("none");
  const [supported, setSupported] = useState(false);
  const [blockReason, setBlockReason] = useState<SpeechInputError | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const recorderRef = useRef<UtteranceRecorder | null>(null);
  const deliveredRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  const onErrorRef = useRef(options.onError);
  const onTranscribingRef = useRef(options.onTranscribingChange);
  onFinalRef.current = onFinal;
  onErrorRef.current = options.onError;
  onTranscribingRef.current = options.onTranscribingChange;

  useEffect(() => {
    const next = pickMode();
    setMode(next);
    setSupported(next !== "none");
    setBlockReason(next === "none" ? getSpeechBlockReason() ?? "unsupported" : null);
    return () => {
      recognitionRef.current?.abort();
      recorderRef.current?.cancel();
    };
  }, []);

  const setBusyTranscribing = useCallback((busy: boolean) => {
    setTranscribing(busy);
    onTranscribingRef.current?.(busy);
  }, []);

  const stopBrowser = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const startBrowser = useCallback(async (): Promise<StartResult> => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return { ok: false, error: "unsupported" };

    const micOk = await ensureMicPermission();
    if (!micOk) return { ok: false, error: "permission-denied" };

    recognitionRef.current?.abort();
    deliveredRef.current = false;

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = isIosDevice();
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = collectTranscript(event);
      if (!transcript || deliveredRef.current) return;
      deliveredRef.current = true;
      onFinalRef.current(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = (event: Event) => {
      setListening(false);
      const code = (event as SpeechRecognitionErrorEvent).error ?? "unknown";
      if (code === "aborted" || deliveredRef.current) return;
      onErrorRef.current?.(mapRecognitionError(code));
    };
    recognition.onnomatch = () => {
      setListening(false);
      if (!deliveredRef.current) onErrorRef.current?.("no-speech");
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      return { ok: true };
    } catch {
      setListening(false);
      return { ok: false, error: "unknown" };
    }
  }, []);

  const stopServer = useCallback(async () => {
    // Claim the recorder first: a manual tap and an auto-stop can race, and
    // only one of them may upload.
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setListening(false);
    if (!recorder) return;
    const result = await recorder.stop();
    if ("error" in result) {
      if (result.error === "too-short") onErrorRef.current?.("no-speech");
      else onErrorRef.current?.(result.error === "permission-denied" ? "permission-denied" : "unknown");
      return;
    }
    setBusyTranscribing(true);
    try {
      const { text } = await transcribeUtterance(result.blob, {
        locale: "en-US",
        filename: `utterance.${result.mimeType.includes("mp4") ? "m4a" : "webm"}`,
      });
      if (!text.trim()) {
        onErrorRef.current?.("no-speech");
        return;
      }
      onFinalRef.current(text.trim());
    } catch {
      onErrorRef.current?.("network");
    } finally {
      setBusyTranscribing(false);
    }
  }, [setBusyTranscribing]);

  const abortServer = useCallback((error: SpeechInputError) => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setListening(false);
    recorder?.cancel();
    onErrorRef.current?.(error);
  }, []);

  const startServer = useCallback(async (): Promise<StartResult> => {
    if (!canUseMediaRecorder()) return { ok: false, error: "unsupported" };
    recorderRef.current?.cancel();
    const recorder = new UtteranceRecorder();
    recorderRef.current = recorder;
    const started = await recorder.start({
      onAutoStop: (reason) => {
        // Silence never reached the mic, so there is nothing worth uploading.
        if (reason === "no-speech") abortServer("no-speech");
        else void stopServer();
      },
    });
    if (!started.ok) {
      recorderRef.current = null;
      const map: Record<string, SpeechInputError> = {
        unsupported: "unsupported",
        "permission-denied": "permission-denied",
        "audio-capture": "audio-capture",
        unknown: "unknown",
      };
      return { ok: false, error: map[started.error] ?? "unknown" };
    }
    setListening(true);
    return { ok: true };
  }, [abortServer, stopServer]);

  const stop = useCallback(() => {
    if (mode === "server") {
      void stopServer();
      return;
    }
    stopBrowser();
  }, [mode, stopBrowser, stopServer]);

  const start = useCallback(async (): Promise<StartResult> => {
    if (mode === "server") return startServer();
    if (mode === "browser") return startBrowser();
    return { ok: false, error: blockReason ?? "unsupported" };
  }, [mode, startBrowser, startServer, blockReason]);

  const toggle = useCallback(async (): Promise<StartResult | { ok: true; stopped: true }> => {
    if (listening) {
      stop();
      return { ok: true, stopped: true };
    }
    return start();
  }, [listening, start, stop]);

  return {
    listening,
    transcribing,
    supported,
    blockReason,
    mode,
    start,
    stop,
    toggle,
  };
}
