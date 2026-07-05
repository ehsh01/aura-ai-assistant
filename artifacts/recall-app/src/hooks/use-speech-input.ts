import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionCtor = new () => SpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechInput(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognitionCtor()));
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback((): boolean => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return false;

    recognitionRef.current?.abort();

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) onFinalRef.current(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      return true;
    } catch {
      setListening(false);
      return false;
    }
  }, []);

  const toggle = useCallback((): boolean => {
    if (listening) {
      stop();
      return true;
    }
    return start();
  }, [listening, start, stop]);

  return { listening, supported, start, stop, toggle };
}
