type SpeechRecognitionCtor = new () => SpeechRecognition;

export type SpeechInputError =
  | "unsupported"
  | "pwa-blocked"
  | "permission-denied"
  | "no-speech"
  | "network"
  | "audio-capture"
  | "aborted"
  | "unknown";

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

import { isStandalonePwa } from "./pwa-env";

export { isStandalonePwa } from "./pwa-env";

/** Apple blocks Web Speech in home-screen PWAs — API exists but never returns results. */
export function getSpeechBlockReason(): SpeechInputError | null {
  if (!getSpeechRecognitionCtor()) return "unsupported";
  if (isIosDevice() && isStandalonePwa()) return "pwa-blocked";
  return null;
}

export function speechErrorMessage(error: SpeechInputError): { title: string; description: string } {
  switch (error) {
    case "unsupported":
      return {
        title: "Voice not available",
        description: "Use Chrome or Safari on a device that supports voice input.",
      };
    case "pwa-blocked":
      return {
        title: "Voice doesn't work in the home screen app",
        description: "Open recall-app.net in Safari (not the installed app) to use the microphone.",
      };
    case "permission-denied":
      return {
        title: "Microphone blocked",
        description: "Allow microphone access in browser settings, then try again.",
      };
    case "no-speech":
      return {
        title: "Didn't hear anything",
        description: "Tap the mic and speak clearly, then wait a moment.",
      };
    case "network":
      return {
        title: "Voice needs internet",
        description: "Speech recognition requires a network connection.",
      };
    case "audio-capture":
      return {
        title: "Microphone unavailable",
        description: "Another app may be using the mic. Close it and try again.",
      };
    case "aborted":
      return {
        title: "Voice stopped",
        description: "Tap the mic again to start listening.",
      };
    default:
      return {
        title: "Voice input failed",
        description: "Try again, or type your question instead.",
      };
  }
}

export function mapRecognitionError(code: string): SpeechInputError {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "permission-denied";
    case "no-speech":
      return "no-speech";
    case "network":
      return "network";
    case "audio-capture":
      return "audio-capture";
    case "aborted":
      return "aborted";
    default:
      return "unknown";
  }
}

export async function ensureMicPermission(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch {
    return false;
  }
}
