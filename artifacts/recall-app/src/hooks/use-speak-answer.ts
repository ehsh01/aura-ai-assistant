import { useCallback, useEffect, useState } from "react";
import {
  getVoiceAnswersEnabled,
  isVoiceAnswersSupported,
  setVoiceAnswersEnabled,
  speakText,
  stopSpeaking,
} from "@/lib/speech-synthesis";

/**
 * Speaks Ask answers when voice is enabled.
 * Uses free browser speech by default; OpenAI TTS only when premium is on.
 */
export function useSpeakAnswer(answer: string | null | undefined, ready: boolean) {
  const supported = isVoiceAnswersSupported();
  const [enabled, setEnabled] = useState(() => getVoiceAnswersEnabled());
  const [speaking, setSpeaking] = useState(false);

  const setVoiceEnabled = useCallback((next: boolean) => {
    setVoiceAnswersEnabled(next);
    setEnabled(next);
    if (!next) {
      stopSpeaking();
      setSpeaking(false);
    }
  }, []);

  const stop = useCallback(() => {
    stopSpeaking();
    setSpeaking(false);
  }, []);

  const replay = useCallback(() => {
    if (!supported || !enabled || !answer?.trim()) return;
    setSpeaking(true);
    void speakText(answer, {
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  }, [answer, enabled, supported]);

  useEffect(() => {
    if (!supported || !enabled || !ready || !answer?.trim()) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }

    let cancelled = false;
    setSpeaking(true);
    void speakText(answer, {
      onEnd: () => {
        if (!cancelled) setSpeaking(false);
      },
      onError: () => {
        if (!cancelled) setSpeaking(false);
      },
    });

    return () => {
      cancelled = true;
      stopSpeaking();
    };
  }, [answer, enabled, ready, supported]);

  useEffect(() => () => stopSpeaking(), []);

  return {
    supported,
    enabled,
    speaking,
    setVoiceEnabled,
    stop,
    replay,
  };
}
