import React, { useCallback } from "react";
import { Mic } from "lucide-react";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { toast } from "@/hooks/use-toast";
import { speechErrorMessage, type SpeechInputError } from "@/lib/speech-support";

interface MicButtonProps {
  onTranscript: (text: string) => void;
  className?: string;
  iconSize?: number;
  title?: string;
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
}: MicButtonProps) {
  const onError = useCallback((error: SpeechInputError) => {
    showSpeechError(error);
  }, []);

  const { listening, supported, blockReason, toggle } = useSpeechInput(onTranscript, { onError });

  const handleClick = async () => {
    if (blockReason) {
      showSpeechError(blockReason);
      return;
    }
    if (!supported) {
      showSpeechError("unsupported");
      return;
    }

    const result = await toggle();
    if (!result.ok) {
      showSpeechError(result.error);
      return;
    }
    if ("stopped" in result) return;

    toast({
      title: "Listening…",
      description: "Speak now, then wait a moment for Recall to respond.",
    });
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      title={listening ? "Stop listening" : title}
      aria-label={listening ? "Stop listening" : title}
      aria-pressed={listening}
      className={`${className} ${listening ? "text-red-400 bg-red-500/20 animate-pulse" : ""}`}
    >
      <Mic size={iconSize} className={listening ? "scale-110" : undefined} />
    </button>
  );
}
