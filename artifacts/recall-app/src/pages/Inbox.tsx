import React, { useEffect, useState } from "react";
import { acceptCapture, listCaptureInbox, updateCapture } from "@workspace/api-client-react";
import { AppLayout } from "@/components/AppLayout";
import { useRecallData } from "@/context/RecallDataContext";
import { toast } from "@/hooks/use-toast";
import type { RecallCaptureItem } from "@/lib/recall-context";

const priorityClass: Record<RecallCaptureItem["suggestedPriority"], string> = {
  low: "text-blue-300 bg-blue-500/10",
  medium: "text-white/60 bg-white/5",
  high: "text-orange-300 bg-orange-500/10",
  urgent: "text-red-300 bg-red-500/10",
};

export function Inbox() {
  const { reloadNotes, reloadTasks } = useRecallData();
  const [items, setItems] = useState<RecallCaptureItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listCaptureInbox();
      setItems(res.items as RecallCaptureItem[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const accept = async (item: RecallCaptureItem) => {
    try {
      await acceptCapture(item.id, {});
      await Promise.all([load(), reloadNotes(), reloadTasks()]);
      toast({ title: "Capture accepted", description: "Recall moved it into notes or tasks." });
    } catch {
      toast({ title: "Could not accept capture", variant: "destructive" });
    }
  };

  const dismiss = async (item: RecallCaptureItem) => {
    try {
      await updateCapture(item.id, { status: "dismissed" });
      await load();
    } catch {
      toast({ title: "Could not dismiss capture", variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#0a0a0f] p-8 text-white">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">Capture</p>
          <h1 className="mt-2 text-3xl font-semibold">AI Inbox</h1>
          <p className="mt-2 text-white/50">
            Review raw captures before Recall turns them into notes, tasks, reminders, or references.
          </p>

          <div className="mt-8 space-y-4">
            {loading && <div className="text-white/40">Loading captures...</div>}
            {!loading && items.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-white/45">
                No pending captures. Use + Capture to send something here.
              </div>
            )}
            {items.map((item) => (
              <article key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">{item.cleanedTitle}</h2>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-indigo-500/10 px-2 py-1 text-indigo-200">
                        {item.suggestedType.replace("_", " ")}
                      </span>
                      <span className={`rounded-full px-2 py-1 ${priorityClass[item.suggestedPriority]}`}>
                        {item.suggestedPriority}
                      </span>
                      {item.suggestedDueDate && (
                        <span className="rounded-full bg-white/5 px-2 py-1 text-white/55">
                          due {item.suggestedDueDate}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void dismiss(item)}
                      className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white/55 hover:text-white"
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      onClick={() => void accept(item)}
                      className="rounded-xl bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400"
                    >
                      Accept
                    </button>
                  </div>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{item.rawText}</p>
                {item.suggestedActions.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.suggestedActions.map((action) => (
                      <span key={action} className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/45">
                        {action}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
