import React from "react";
import { Mic, MicOff } from "lucide-react";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { toast } from "@/hooks/use-toast";

interface MicButtonProps {
  onTranscript: (text: string) => void;
  className?: string;
  iconSize?: number;
  title?: string;
}

export function MicButton({
  onTranscript,
  className = "",
  iconSize = 16,
  title = "Voice input",
}: MicButtonProps) {
  const { listening, supported, toggle } = useSpeechInput(onTranscript);

  const handleClick = () => {
    if (!supported) {
      toast({
        title: "Voice not available",
        description: "Use Chrome or Safari — microphone permission is required.",
        variant: "destructive",
      });
      return;
    }
    toggle();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={listening ? "Stop listening" : title}
      aria-label={listening ? "Stop listening" : title}
      className={`${className} ${listening ? "text-red-400 bg-red-500/20" : ""}`}
    >
      {listening ? <MicOff size={iconSize} /> : <Mic size={iconSize} />}
    </button>
  );
}
