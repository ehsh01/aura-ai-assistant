import { useEffect, useState } from "react";
import { Sparkles, Loader2, ArrowUp, FileText, CheckSquare, Inbox } from "lucide-react";
import { MicButton } from "@/components/MicButton";

type Props = {
  aiPending?: boolean;
  /** Prefill from deep link (?capture=…) or share target. */
  initialText?: string | null;
  onAsk: (text: string) => void;
  onSaveNote: (text: string) => void;
  onSaveTask: (text: string) => void;
  onSendInbox: (text: string) => void;
};

export function BrainDumpInput({
  aiPending,
  initialText,
  onAsk,
  onSaveNote,
  onSaveTask,
  onSendInbox,
}: Props) {
  const [text, setText] = useState(initialText?.trim() ?? "");

  useEffect(() => {
    const next = initialText?.trim();
    if (next) setText(next);
  }, [initialText]);

  const trimmed = text.trim();

  const run = (fn: (value: string) => void) => {
    if (!trimmed) return;
    fn(trimmed);
    setText("");
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px)+0.5rem)] md:bottom-6">
      <div className="pointer-events-auto w-[calc(100%-1.5rem)] max-w-2xl px-0">
        {trimmed && (
          <div className="mb-2 flex flex-wrap justify-center gap-2">
            <Chip icon={<Sparkles className="h-3.5 w-3.5" />} label="Ask Recall" onClick={() => run(onAsk)} primary />
            <Chip icon={<FileText className="h-3.5 w-3.5" />} label="Note" onClick={() => run(onSaveNote)} />
            <Chip icon={<CheckSquare className="h-3.5 w-3.5" />} label="Task" onClick={() => run(onSaveTask)} />
            <Chip icon={<Inbox className="h-3.5 w-3.5" />} label="Inbox" onClick={() => run(onSendInbox)} />
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(onAsk);
          }}
          className="ai-toolbar-wrap flex items-center gap-2 p-2"
        >
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-300">
            {aiPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </span>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Tell Recall anything…"
            className="min-w-0 flex-1 border-none bg-transparent text-sm text-white/90 outline-none placeholder:text-white/40"
          />
          <MicButton
            onTranscript={(t) => setText((prev) => (prev ? `${prev} ${t}` : t))}
            iconSize={18}
            title="Voice capture"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/5 hover:text-white/80"
          />
          <button
            type="submit"
            disabled={!trimmed || aiPending}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white transition-colors hover:bg-indigo-400 disabled:opacity-40"
            aria-label="Ask Recall"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

function Chip({
  icon,
  label,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-md transition-transform hover:-translate-y-0.5 ${
        primary
          ? "bg-indigo-500 text-white shadow-indigo-500/25"
          : "border border-white/10 bg-[#14141c]/90 text-white/70"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
