const VOICE_PREF_KEY = "recall.voiceAnswers";
/** Paid OpenAI TTS — off by default; browser speech is free and good enough. */
const PREMIUM_TTS_PREF_KEY = "recall.premiumTts";

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

/**
 * OpenAI TTS is opt-in. Voice Answers still work via the browser synthesizer
 * when this is off — which is the default, so enabling voice does not spend
 * money on every Ask answer.
 */
export function getPremiumTtsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(PREMIUM_TTS_PREF_KEY);
  return raw === "1" || raw === "true";
}

export function setPremiumTtsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREMIUM_TTS_PREF_KEY, enabled ? "1" : "0");
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
    // Speak money so cents are clear: $12.81 → "12 dollars and 81 cents"
    .replace(/(-)?\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\b/g, (_m, sign: string | undefined, dollars: string, cents: string) => {
      const neg = Boolean(sign);
      const d = Number(dollars.replace(/,/g, ""));
      const c = Number(cents);
      const dollarWord = d === 1 ? "dollar" : "dollars";
      const centWord = c === 1 ? "cent" : "cents";
      const core =
        c === 0
          ? `${d} ${dollarWord}`
          : d === 0
            ? `${c} ${centWord}`
            : `${d} ${dollarWord} and ${c} ${centWord}`;
      return neg ? `minus ${core}` : core;
    })
    .replace(/\s+/g, " ")
    .trim();
}
