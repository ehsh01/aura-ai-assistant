export type VoiceSessionPhase =
  | "inactive"
  | "listening"
  | "thinking"
  | "speaking"
  | "ended"
  | "cap-reached";

export type VoiceSessionState = {
  phase: VoiceSessionPhase;
  silenceTimeoutMs: number;
  silenceDeadlineAt: number | null;
  message: string | null;
};

export type VoiceSessionAction =
  | { type: "configure"; silenceTimeoutMs: number; now: number }
  | { type: "start"; now: number }
  | { type: "speech-started"; now: number }
  | { type: "turn-started" }
  | { type: "speaking-started" }
  | { type: "listen"; now: number }
  | { type: "silence-timeout"; now: number }
  | { type: "cap-reached"; message: string }
  | { type: "stop"; message?: string };

export function createVoiceSessionState(
  silenceTimeoutMs = 8_000,
): VoiceSessionState {
  return {
    phase: "inactive",
    silenceTimeoutMs,
    silenceDeadlineAt: null,
    message: null,
  };
}

export function isVoiceSessionActive(state: VoiceSessionState): boolean {
  return (
    state.phase === "listening" ||
    state.phase === "thinking" ||
    state.phase === "speaking"
  );
}

export function shouldBargeIn(state: VoiceSessionState): boolean {
  return state.phase === "speaking";
}

function listeningState(
  state: VoiceSessionState,
  now: number,
): VoiceSessionState {
  return {
    ...state,
    phase: "listening",
    silenceDeadlineAt: now + state.silenceTimeoutMs,
    message: null,
  };
}

export function voiceSessionReducer(
  state: VoiceSessionState,
  action: VoiceSessionAction,
): VoiceSessionState {
  switch (action.type) {
    case "configure": {
      const silenceTimeoutMs = Math.min(
        120_000,
        Math.max(1_000, Math.floor(action.silenceTimeoutMs)),
      );
      return {
        ...state,
        silenceTimeoutMs,
        silenceDeadlineAt:
          state.phase === "listening"
            ? action.now + silenceTimeoutMs
            : state.silenceDeadlineAt,
      };
    }
    case "start":
      return listeningState(state, action.now);
    case "listen":
      return isVoiceSessionActive(state)
        ? listeningState(state, action.now)
        : state;
    case "speech-started":
      return isVoiceSessionActive(state)
        ? listeningState(state, action.now)
        : state;
    case "turn-started":
      return isVoiceSessionActive(state)
        ? { ...state, phase: "thinking", silenceDeadlineAt: null }
        : state;
    case "speaking-started":
      return isVoiceSessionActive(state)
        ? { ...state, phase: "speaking", silenceDeadlineAt: null }
        : state;
    case "silence-timeout":
      if (
        state.phase !== "listening" ||
        state.silenceDeadlineAt === null ||
        action.now < state.silenceDeadlineAt
      ) {
        return state;
      }
      return {
        ...state,
        phase: "ended",
        silenceDeadlineAt: null,
        message: `Session ended after ${Math.round(state.silenceTimeoutMs / 1_000)} seconds of silence.`,
      };
    case "cap-reached":
      return {
        ...state,
        phase: "cap-reached",
        silenceDeadlineAt: null,
        message: action.message,
      };
    case "stop":
      return {
        ...state,
        phase: "ended",
        silenceDeadlineAt: null,
        message: action.message ?? "Voice session ended.",
      };
  }
}
