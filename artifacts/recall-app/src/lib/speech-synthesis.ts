import {
  getPremiumTtsEnabled,
  isSpeechSynthesisSupported,
  pickPreferredVoice,
  setVoiceAnswersEnabled as setVoicePref,
  textForSpeech,
} from "./speech-synthesis-shared";

export {
  getPremiumTtsEnabled,
  getVoiceAnswersEnabled,
  isSpeechSynthesisSupported,
  isVoiceAnswersSupported,
  pickPreferredVoice,
  setPremiumTtsEnabled,
  textForSpeech,
} from "./speech-synthesis-shared";

export function setVoiceAnswersEnabled(enabled: boolean): void {
  setVoicePref(enabled);
  if (!enabled) stopSpeaking();
}

const API_BASE = "/api";

let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
let speakGeneration = 0;

function cleanupAudio(): void {
  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

export function stopSpeaking(): void {
  speakGeneration += 1;
  cleanupAudio();
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel();
  }
}

export type SpeakOptions = {
  rate?: number;
  pitch?: number;
  voice?: string;
  /** Force OpenAI TTS even when the premium preference is off. */
  premium?: boolean;
  onEnd?: () => void;
  onError?: () => void;
};

async function fetchOpenAiTts(text: string, voice?: string): Promise<Blob> {
  const headers: Record<string, string> = {
    Accept: "audio/mpeg",
    "Content-Type": "application/json",
  };

  const res = await fetch(`${API_BASE}/ai/tts`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ text, ...(voice ? { voice } : {}) }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `TTS failed (${res.status})`);
  }
  return res.blob();
}

function speakBrowser(cleaned: string, options: SpeakOptions, generation: number): boolean {
  if (!isSpeechSynthesisSupported()) {
    options.onError?.();
    return false;
  }

  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(cleaned);
  utter.rate = options.rate ?? 1.02;
  utter.pitch = options.pitch ?? 1;
  const voice = pickPreferredVoice();
  if (voice) utter.voice = voice;

  utter.onend = () => {
    if (generation === speakGeneration) options.onEnd?.();
  };
  utter.onerror = () => {
    if (generation === speakGeneration) options.onError?.();
  };

  const start = () => {
    if (generation !== speakGeneration) return;
    window.speechSynthesis.speak(utter);
  };

  if (window.speechSynthesis.getVoices().length === 0) {
    const onVoices = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
      const late = pickPreferredVoice();
      if (late) utter.voice = late;
      start();
    };
    window.speechSynthesis.addEventListener("voiceschanged", onVoices);
    window.setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
      if (generation === speakGeneration && !window.speechSynthesis.speaking) start();
    }, 250);
  } else {
    start();
  }

  return true;
}

/**
 * Speak an Ask answer. Browser speech is the default (free). OpenAI TTS only
 * runs when the user has enabled premium voice or the caller opts in.
 */
export async function speakText(text: string, options: SpeakOptions = {}): Promise<boolean> {
  const cleaned = textForSpeech(text);
  if (!cleaned) return false;

  stopSpeaking();
  const generation = speakGeneration;
  const usePremium = options.premium === true || getPremiumTtsEnabled();

  if (!usePremium) {
    return speakBrowser(cleaned, options, generation);
  }

  try {
    const blob = await fetchOpenAiTts(cleaned, options.voice);
    if (generation !== speakGeneration) return false;

    const url = URL.createObjectURL(blob);
    currentObjectUrl = url;
    const audio = new Audio(url);
    currentAudio = audio;

    audio.onended = () => {
      if (generation !== speakGeneration) return;
      cleanupAudio();
      options.onEnd?.();
    };
    audio.onerror = () => {
      if (generation !== speakGeneration) return;
      cleanupAudio();
      speakBrowser(cleaned, options, generation);
    };

    await audio.play();
    return true;
  } catch {
    if (generation !== speakGeneration) return false;
    return speakBrowser(cleaned, options, generation);
  }
}
