import React, { useCallback, useRef } from "react";
import { Mic, Loader2 } from "lucide-react";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { toast } from "@/hooks/use-toast";
import {
  speechErrorMessage,
  type SpeechInputError,
} from "@/lib/speech-support";

export type MicButtonController = ReturnType<typeof useSpeechInput>;

interface MicButtonProps {
  onTranscript: (text: string) => void;
  className?: string;
  iconSize?: number;
  title?: string;
  children?: React.ReactNode;
  listeningLabel?: React.ReactNode;
  allowServerTranscription?: boolean;
  onListeningChange?: (listening: boolean) => void;
  testId?: string;
  controller?: MicButtonController;
  /** Return false to consume the activation (for example, to stop speech). */
  onBeforeToggle?: () => boolean | void;
  /** Called after a new listening session starts successfully. */
  onActivated?: () => void;
  /** A long press listens only while held; a quick tap uses auto-stop. */
  holdToTalk?: boolean;
  /** Suppress transient listening/recording toasts for always-visible controls. */
  quiet?: boolean;
}

export function showSpeechError(error: SpeechInputError) {
  const { title, description } = speechErrorMessage(error);
  toast({ title, description, variant: "destructive" });
}

function MicButtonControl({
  controller,
  className = "",
  iconSize = 16,
  title = "Voice input",
  children,
  listeningLabel,
  testId,
  onBeforeToggle,
  onActivated,
  holdToTalk = false,
  quiet = false,
}: MicButtonProps & { controller: MicButtonController }) {
  const { listening, transcribing, supported, blockReason, mode, toggle } =
    controller;
  const pressedAtRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  const handleClick = async () => {
    if (onBeforeToggle?.() === false) return;
    if (!supported) {
      showSpeechError(blockReason ?? "unsupported");
      return;
    }

    const result = await toggle();
    if (!result.ok) {
      showSpeechError(result.error);
      return;
    }
    if ("stopped" in result) {
      if (mode === "server" && !quiet) {
        toast({
          title: "Transcribing…",
          description: "Turning your recording into text.",
        });
      }
      return;
    }
    onActivated?.();

    if (!quiet)
      toast({
        title: mode === "server" ? "Recording…" : "Listening…",
        description:
          mode === "server"
            ? "Just stop talking when you’re done, or tap the mic to end it now."
            : "Speak now, then wait a moment for Recall to respond.",
      });
  };

  const handlePointerDown = () => {
    if (!holdToTalk) return;
    pressedAtRef.current = performance.now();
    suppressClickRef.current = true;
    void handleClick();
  };

  const handlePointerUp = () => {
    if (!holdToTalk || pressedAtRef.current == null) return;
    const heldFor = performance.now() - pressedAtRef.current;
    pressedAtRef.current = null;
    if (heldFor >= 350 && controller.listening) controller.stop();
  };

  const label = transcribing
    ? "Transcribing…"
    : listening
      ? (listeningLabel ?? "Listening…")
      : children;

  return (
    <button
      type="button"
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        void handleClick();
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      disabled={transcribing}
      title={
        transcribing
          ? "Transcribing…"
          : listening
            ? mode === "server"
              ? "Stop recording"
              : "Stop listening"
            : title
      }
      aria-label={
        transcribing
          ? "Transcribing"
          : listening
            ? mode === "server"
              ? "Stop recording"
              : "Stop listening"
            : title
      }
      aria-pressed={listening}
      aria-busy={transcribing || undefined}
      data-testid={testId}
      className={`${className} ${listening ? "text-red-400 bg-red-500/20 animate-pulse" : ""} ${
        transcribing ? "opacity-70" : ""
      }`}
    >
      {transcribing ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : (
        <Mic size={iconSize} className={listening ? "scale-110" : undefined} />
      )}
      {label != null && typeof label !== "boolean" && <span>{label}</span>}
    </button>
  );
}

function ManagedMicButton(props: MicButtonProps) {
  const onError = useCallback((error: SpeechInputError) => {
    showSpeechError(error);
  }, []);
  const controller = useSpeechInput(props.onTranscript, {
    onError,
    allowServerTranscription: props.allowServerTranscription,
    onListeningChange: props.onListeningChange,
  });
  return <MicButtonControl {...props} controller={controller} />;
}

export function MicButton(props: MicButtonProps) {
  if (props.controller) {
    return <MicButtonControl {...props} controller={props.controller} />;
  }
  return <ManagedMicButton {...props} />;
}
