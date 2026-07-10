const VOICE_PREF_KEY = "recall.voiceAnswers";

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function getVoiceAnswersEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const raw = localStorage.getItem(VOICE_PREF_KEY);
  if (raw === null) return true;
  return raw === "1" || raw === "true";
}

export function setVoiceAnswersEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(VOICE_PREF_KEY, enabled ? "1" : "0");
  if (!enabled) stopSpeaking();
}

/** Prefer a natural English voice when the browser exposes several. */
export function pickPreferredVoice(): SpeechSynthesisVoice | null {
  if (!isSpeechSynthesisSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const scored = voices.map((v) => {
    const name = v.name.toLowerCase();
    const lang = v.lang.toLowerCase();
    let score = 0;
    if (lang.startsWith("en")) score += 10;
    if (lang === "en-us" || lang === "en_us") score += 3;
    if (lang === "en-gb" || lang === "en_gb") score += 2;
    if (/samantha|karen|moira|serena|aria|jenny|natural|premium|enhanced|google/.test(name)) {
      score += 8;
    }
    if (v.localService) score += 1;
    if (/compact|eloquence|novelty/.test(name)) score -= 4;
    return { v, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.v ?? null;
}

/** Strip markdown / UI noise so TTS sounds natural. */
export function textForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stopSpeaking(): void {
  if (!isSpeechSynthesisSupported()) return;
  window.speechSynthesis.cancel();
}

export type SpeakOptions = {
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: () => void;
};

/**
 * Speak text with the browser voice. Cancels any in-progress utterance first.
 * Returns false if synthesis is unavailable or text is empty.
 */
export function speakText(text: string, options: SpeakOptions = {}): boolean {
  if (!isSpeechSynthesisSupported()) return false;
  const cleaned = textForSpeech(text);
  if (!cleaned) return false;

  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(cleaned);
  utter.rate = options.rate ?? 1.02;
  utter.pitch = options.pitch ?? 1;
  const voice = pickPreferredVoice();
  if (voice) utter.voice = voice;

  utter.onend = () => options.onEnd?.();
  utter.onerror = () => options.onError?.();

  // Chrome sometimes needs voices to load asynchronously.
  const start = () => window.speechSynthesis.speak(utter);
  if (window.speechSynthesis.getVoices().length === 0) {
    const onVoices = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
      const late = pickPreferredVoice();
      if (late) utter.voice = late;
      start();
    };
    window.speechSynthesis.addEventListener("voiceschanged", onVoices);
    // Fallback if voiceschanged never fires.
    window.setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
      if (!window.speechSynthesis.speaking) start();
    }, 250);
  } else {
    start();
  }

  return true;
}
