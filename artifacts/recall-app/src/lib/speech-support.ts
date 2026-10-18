type SpeechRecognitionCtor = {
  new (): SpeechRecognition;
  available?: (options: {
    langs: string[];
    processLocally: boolean;
  }) => Promise<"available" | "downloadable" | "downloading" | "unavailable">;
};

export type SpeechInputError =
  | "unsupported"
  | "pwa-blocked"
  | "permission-denied"
  | "no-speech"
  | "network"
  | "audio-capture"
  | "language-not-supported"
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

export async function canProcessSpeechLocally(
  Ctor: SpeechRecognitionCtor,
  lang: string,
): Promise<boolean> {
  if (typeof Ctor.available !== "function") return false;
  try {
    return (
      (await Ctor.available({ langs: [lang], processLocally: true })) ===
      "available"
    );
  } catch {
    return false;
  }
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    nav.standalone === true
  );
}

/** Apple blocks Web Speech in home-screen PWAs — API exists but never returns results. */
export function getSpeechBlockReason(): SpeechInputError | null {
  if (!getSpeechRecognitionCtor()) return "unsupported";
  if (isIosDevice() && isStandalonePwa()) return "pwa-blocked";
  return null;
}

export function speechErrorMessage(error: SpeechInputError): {
  title: string;
  description: string;
} {
  switch (error) {
    case "unsupported":
      return {
        title: "Voice not available",
        description:
          "Voice works in Safari/Chrome tab, or use your keyboard's dictation mic",
      };
    case "pwa-blocked":
      return {
        title: "Voice not available",
        description:
          "Voice works in Safari/Chrome tab, or use your keyboard's dictation mic",
      };
    case "permission-denied":
      return {
        title: "Microphone blocked",
        description:
          "Allow microphone access in browser settings, then try again.",
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
        description:
          "Another app may be using the mic. Close it and try again.",
      };
    case "language-not-supported":
      return {
        title: "On-device language unavailable",
        description:
          "Chrome's English speech pack is not installed. Recall will use normal browser recognition instead.",
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
    case "language-not-supported":
      return "language-not-supported";
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
