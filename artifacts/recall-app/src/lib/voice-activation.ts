export type VoiceAskActivation = {
  transcript: string;
  source: "wake-word";
};

let pendingActivation: VoiceAskActivation | null = null;

export function publishVoiceAsk(activation: VoiceAskActivation): void {
  pendingActivation = activation;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("recall:voice-ask"));
  }
}

export function subscribeVoiceAsk(
  handler: (activation: VoiceAskActivation) => void,
): () => void {
  const consume = () => {
    const activation = pendingActivation;
    if (!activation) return;
    pendingActivation = null;
    handler(activation);
  };

  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("recall:voice-ask", consume);
  queueMicrotask(consume);
  return () => window.removeEventListener("recall:voice-ask", consume);
}

export function resetVoiceActivationForTests(): void {
  pendingActivation = null;
}
