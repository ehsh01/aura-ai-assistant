import {
  isSpeechSynthesisSupported,
  pickPreferredVoice,
  setVoiceAnswersEnabled as setVoicePref,
  textForSpeech,
} from "./speech-synthesis-shared";

export {
  getPremiumTtsEnabled,
  getServerSttEnabled,
  getVoiceAnswersEnabled,
  isSpeechSynthesisSupported,
  isVoiceAnswersSupported,
  pickPreferredVoice,
  setPremiumTtsEnabled,
  setServerSttEnabled,
  textForSpeech,
} from "./speech-synthesis-shared";

export function setVoiceAnswersEnabled(enabled: boolean): void {
  setVoicePref(enabled);
  if (!enabled) stopSpeaking();
}

const API_BASE = "/api";

let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
let currentAbortController: AbortController | null = null;
let speakGeneration = 0;

function cleanupAudio(): void {
  currentAbortController?.abort();
  currentAbortController = null;
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
  /** Talk to Recall explicitly opts into paid OpenAI TTS. */
  premium?: boolean;
  onEnd?: () => void;
  onError?: () => void;
};

class ServerTtsBlockedError extends Error {
  constructor(readonly reason: "disabled" | "daily_limit") {
    super(`Server TTS blocked: ${reason}`);
  }
}

async function fetchOpenAiTts(
  text: string,
  signal: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "audio/mpeg",
    "Content-Type": "application/json",
  };

  const res = await fetch(`${API_BASE}/ai/tts`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      message?: string;
      reason?: string;
    };
    if (err.reason === "disabled" || err.reason === "daily_limit") {
      throw new ServerTtsBlockedError(err.reason);
    }
    throw new Error(err.message ?? `TTS failed (${res.status})`);
  }
  return res;
}

function configurePremiumAudio(
  audio: HTMLAudioElement,
  options: SpeakOptions,
  generation: number,
): void {
  currentAudio = audio;
  audio.onended = () => {
    if (generation !== speakGeneration) return;
    cleanupAudio();
    options.onEnd?.();
  };
  audio.onerror = () => {
    if (generation !== speakGeneration) return;
    cleanupAudio();
    options.onError?.();
  };
}

async function appendSourceBuffer(
  sourceBuffer: SourceBuffer,
  chunk: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onEnd = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not append streamed TTS audio"));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("TTS playback stopped", "AbortError"));
    };
    const cleanup = () => {
      sourceBuffer.removeEventListener("updateend", onEnd);
      sourceBuffer.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    sourceBuffer.addEventListener("updateend", onEnd, { once: true });
    sourceBuffer.addEventListener("error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
    sourceBuffer.appendBuffer(new Uint8Array(chunk));
  });
}

async function playMediaSourceResponse(
  response: Response,
  options: SpeakOptions,
  generation: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (!response.body) throw new Error("TTS returned no audio stream");
  const mediaSource = new MediaSource();
  const url = URL.createObjectURL(mediaSource);
  currentObjectUrl = url;
  const audio = new Audio(url);
  configurePremiumAudio(audio, options, generation);

  const opened = new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not open streamed TTS audio"));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("TTS playback stopped", "AbortError"));
    };
    const cleanup = () => {
      mediaSource.removeEventListener("sourceopen", onOpen);
      mediaSource.removeEventListener("error", onError);
      mediaSource.removeEventListener("sourceclose", onError);
      signal.removeEventListener("abort", onAbort);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    mediaSource.addEventListener("sourceopen", onOpen, { once: true });
    mediaSource.addEventListener("error", onError, { once: true });
    mediaSource.addEventListener("sourceclose", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
  await opened;
  if (generation !== speakGeneration) return false;

  const sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
  const reader = response.body.getReader();
  let playing: Promise<void> | null = null;
  try {
    while (generation === speakGeneration) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > 0) {
        await appendSourceBuffer(sourceBuffer, value, signal);
        playing ??= audio.play();
      }
    }
    if (
      generation === speakGeneration &&
      mediaSource.readyState === "open" &&
      !sourceBuffer.updating
    ) {
      mediaSource.endOfStream();
    }
  } finally {
    if (generation !== speakGeneration) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
  if (!playing) throw new Error("TTS returned an empty audio stream");
  await playing;
  return generation === speakGeneration;
}

async function playBlobResponse(
  response: Response,
  options: SpeakOptions,
  generation: number,
): Promise<boolean> {
  const blob = await response.blob();
  if (generation !== speakGeneration) return false;
  const url = URL.createObjectURL(blob);
  currentObjectUrl = url;
  const audio = new Audio(url);
  configurePremiumAudio(audio, options, generation);
  await audio.play();
  return true;
}

function speakBrowser(
  cleaned: string,
  options: SpeakOptions,
  generation: number,
): boolean {
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
      if (generation === speakGeneration && !window.speechSynthesis.speaking)
        start();
    }, 250);
  } else {
    start();
  }

  return true;
}

/**
 * Speak an answer. Standard Ask uses free browser speech; Talk explicitly uses
 * server TTS and falls back to the browser only for a server-reported cap or
 * kill switch.
 */
export async function speakText(
  text: string,
  options: SpeakOptions = {},
): Promise<boolean> {
  const cleaned = textForSpeech(text);
  if (!cleaned) return false;

  stopSpeaking();
  const generation = speakGeneration;
  const usePremium = options.premium === true;

  if (!usePremium) {
    return speakBrowser(cleaned, options, generation);
  }

  try {
    const controller = new AbortController();
    currentAbortController = controller;
    const response = await fetchOpenAiTts(cleaned, controller.signal);
    if (generation !== speakGeneration) return false;
    const canStream =
      typeof MediaSource !== "undefined" &&
      MediaSource.isTypeSupported("audio/mpeg") &&
      Boolean(response.body);
    return canStream
      ? await playMediaSourceResponse(
          response,
          options,
          generation,
          controller.signal,
        )
      : await playBlobResponse(response, options, generation);
  } catch (error) {
    if (generation !== speakGeneration) return false;
    if (error instanceof ServerTtsBlockedError) {
      return speakBrowser(cleaned, options, generation);
    }
    cleanupAudio();
    options.onError?.();
    return false;
  }
}
