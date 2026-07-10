const VOICE_PREF_KEY = "recall.voiceAnswers";

export function isSpeechSynthesisSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window
  );
}

export function isVoiceAnswersSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    (typeof Audio !== "undefined" || isSpeechSynthesisSupported())
  );
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
