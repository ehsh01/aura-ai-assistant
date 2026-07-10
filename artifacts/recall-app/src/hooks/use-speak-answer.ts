import { useCallback, useEffect, useState } from "react";
import {
  getVoiceAnswersEnabled,
  isSpeechSynthesisSupported,
  setVoiceAnswersEnabled,
  speakText,
  stopSpeaking,
} from "@/lib/speech-synthesis";

/**
 * Speaks Ask answers when voice is enabled. Stops on unmount / when answer clears.
 */
export function useSpeakAnswer(answer: string | null | undefined, ready: boolean) {
  const supported = isSpeechSynthesisSupported();
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
    speakText(answer, {
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

    setSpeaking(true);
    speakText(answer, {
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });

    return () => {
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
