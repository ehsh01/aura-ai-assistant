import { useCallback, useEffect, useRef, useState } from "react";
import {
  ensureMicPermission,
  getSpeechBlockReason,
  getSpeechRecognitionCtor,
  isIosDevice,
  mapRecognitionError,
  type SpeechInputError,
} from "@/lib/speech-support";

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

type UseSpeechInputOptions = {
  onError?: (error: SpeechInputError) => void;
};

export function useSpeechInput(onFinal: (text: string) => void, options: UseSpeechInputOptions = {}) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [blockReason, setBlockReason] = useState<SpeechInputError | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const deliveredRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  const onErrorRef = useRef(options.onError);
  onFinalRef.current = onFinal;
  onErrorRef.current = options.onError;

  useEffect(() => {
    const block = getSpeechBlockReason();
    setBlockReason(block);
    setSupported(block === null);
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(async (): Promise<StartResult> => {
    const block = getSpeechBlockReason();
    if (block) {
      setBlockReason(block);
      setSupported(false);
      return { ok: false, error: block };
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      return { ok: false, error: "unsupported" };
    }

    const micOk = await ensureMicPermission();
    if (!micOk) {
      return { ok: false, error: "permission-denied" };
    }

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

    recognition.onend = () => {
      setListening(false);
    };

    recognition.onerror = (event: Event) => {
      setListening(false);
      const code = (event as SpeechRecognitionErrorEvent).error ?? "unknown";
      if (code === "aborted" || deliveredRef.current) return;
      onErrorRef.current?.(mapRecognitionError(code));
    };

    recognition.onnomatch = () => {
      setListening(false);
      if (!deliveredRef.current) {
        onErrorRef.current?.("no-speech");
      }
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

  const toggle = useCallback(async (): Promise<StartResult | { ok: true; stopped: true }> => {
    if (listening) {
      stop();
      return { ok: true, stopped: true };
    }
    return start();
  }, [listening, start, stop]);

  return { listening, supported, blockReason, start, stop, toggle };
}
