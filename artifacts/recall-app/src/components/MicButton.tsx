import React, { useCallback } from "react";
import { Mic, Loader2 } from "lucide-react";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { toast } from "@/hooks/use-toast";
import { speechErrorMessage, type SpeechInputError } from "@/lib/speech-support";

interface MicButtonProps {
  onTranscript: (text: string) => void;
  className?: string;
  iconSize?: number;
  title?: string;
  children?: React.ReactNode;
  listeningLabel?: string;
}

function showSpeechError(error: SpeechInputError) {
  const { title, description } = speechErrorMessage(error);
  toast({ title, description, variant: "destructive" });
}

export function MicButton({
  onTranscript,
  className = "",
  iconSize = 16,
  title = "Voice input",
  children,
  listeningLabel,
}: MicButtonProps) {
  const onError = useCallback((error: SpeechInputError) => {
    showSpeechError(error);
  }, []);

  const { listening, transcribing, supported, mode, toggle } = useSpeechInput(onTranscript, {
    onError,
  });

  const handleClick = async () => {
    if (!supported) {
      showSpeechError("unsupported");
      return;
    }

    const result = await toggle();
    if (!result.ok) {
      showSpeechError(result.error);
      return;
    }
    if ("stopped" in result) {
      if (mode === "server") {
        toast({ title: "Transcribing…", description: "Turning your recording into text." });
      }
      return;
    }

    toast({
      title: mode === "server" ? "Recording…" : "Listening…",
      description:
        mode === "server"
          ? "Just stop talking when you’re done, or tap the mic to end it now."
          : "Speak now, then wait a moment for Recall to respond.",
    });
  };

  const label = transcribing
    ? "Transcribing…"
    : listening
      ? listeningLabel ?? "Listening…"
      : children;

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
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
