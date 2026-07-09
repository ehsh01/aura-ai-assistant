import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import {
  flushCaptureQueue,
  subscribeCaptureQueue,
} from "@/lib/capture-queue";
import { toast } from "@/hooks/use-toast";

/**
 * Compact banner when captures are waiting to sync (offline / failed ingest).
 */
export function OfflineQueueBanner() {
  const [count, setCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => subscribeCaptureQueue(setCount), []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (count <= 0) return null;

  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await flushCaptureQueue();
      if (result.sent > 0) {
        toast({
          title: "Queued captures synced",
          description: `${result.sent} capture${result.sent === 1 ? "" : "s"} sent to AI Inbox.`,
        });
      } else if (result.remaining > 0) {
        toast({
          title: online ? "Still waiting" : "You're offline",
          description: online
            ? "Couldn't reach the server yet. Will retry automatically."
            : `${result.remaining} capture${result.remaining === 1 ? "" : "s"} will sync when you're back online.`,
          variant: "destructive",
        });
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      className="flex items-center gap-3 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-[13px] text-amber-100/90"
      role="status"
    >
      <CloudOff size={16} className="flex-shrink-0 text-amber-300/90" />
      <p className="min-w-0 flex-1 truncate">
        {online
          ? `${count} capture${count === 1 ? "" : "s"} waiting to sync`
          : `Offline — ${count} capture${count === 1 ? "" : "s"} saved locally`}
      </p>
      <button
        type="button"
        onClick={() => void syncNow()}
        disabled={syncing || !online}
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-amber-500/20 px-2.5 py-1 text-[12px] font-medium text-amber-100 hover:bg-amber-500/30 disabled:opacity-40"
      >
        <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
        Sync
      </button>
    </div>
  );
}
