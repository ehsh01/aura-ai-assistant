import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Hourglass } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { toast } from "@/hooks/use-toast";
import {
  completeWaitingItem,
  confirmWaitingCandidate,
  dismissWaitingItem,
  listWaitingItems,
  reopenWaitingItem,
  snoozeWaitingItem,
  type WaitingItemRecord,
} from "@/lib/recall-api";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysWaiting(item: WaitingItemRecord): number {
  const base = item.promisedAt ?? item.createdAt;
  const t = new Date(base).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

const SOURCE_LABEL: Record<string, string> = {
  source_record: "email",
  capture_item: "capture",
  note: "note",
  task: "task",
  manual: "manual",
};

function sourceLine(item: WaitingItemRecord): string {
  const src = SOURCE_LABEL[item.sourceEntityType] ?? item.sourceEntityType;
  const evidence =
    typeof item.metadata?.evidenceSnippet === "string"
      ? item.metadata.evidenceSnippet
      : "";
  return evidence ? `via ${src} · “${evidence.slice(0, 110)}${evidence.length > 110 ? "…" : ""}”` : `via ${src}`;
}

export function WaitingList() {
  const [items, setItems] = useState<WaitingItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const refresh = useCallback(() => {
    void listWaitingItems({ status: "all" })
      .then((res) => setItems(res.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const groups = useMemo(() => {
    const candidates = items.filter((i) => i.status === "candidate");
    const open = items.filter((i) => i.status === "open");
    const snoozed = items.filter((i) => i.status === "snoozed");
    const history = items.filter(
      (i) => i.status === "completed" || i.status === "dismissed",
    );
    return { candidates, open, snoozed, history };
  }, [items]);

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      toast({ title: done });
      refresh();
    } catch (err) {
      toast({
        title: "That didn't work",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto mx-auto w-full max-w-3xl px-4 pb-24 pt-6">
        <header className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-sky-400/30 bg-sky-500/10 text-sky-300">
            <Hourglass size={18} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold leading-tight">Waiting for</h1>
            <p className="text-sm text-white/45">
              What others owe you — replies, documents, confirmations.
            </p>
          </div>
        </header>

        {loading ? (
          <p className="mt-10 text-sm text-white/40">Loading…</p>
        ) : (
          <>
            {groups.candidates.length > 0 && (
              <section className="mt-6" aria-label="Review suggestions">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-300/80">
                  Review first ({groups.candidates.length})
                </h2>
                <p className="mt-1 text-xs text-white/40">
                  Aura thinks these might be follow-ups. Nothing is tracked until you confirm.
                </p>
                <ol className="mt-3 space-y-2">
                  {groups.candidates.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-2xl border border-violet-400/25 bg-violet-500/[0.07] px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">
                            {item.deliverable}
                          </p>
                          <p className="mt-0.5 text-xs text-white/50">
                            {item.ownerName} · {sourceLine(item)}
                          </p>
                          {item.candidateReason && (
                            <p className="mt-1 text-xs text-violet-200/80">
                              {item.candidateReason}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={busy === item.id}
                          onClick={() =>
                            void run(item.id, () => confirmWaitingCandidate(item.id), "Tracking it now")
                          }
                          className="rounded-full bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-50"
                        >
                          Confirm
                        </button>
                        <Link
                          href={item.href}
                          className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 no-underline hover:bg-white/[0.08]"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          disabled={busy === item.id}
                          onClick={() =>
                            void run(item.id, () => snoozeWaitingItem(item.id, { preset: "3d" }), "Snoozed 3 days")
                          }
                          className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/[0.08] disabled:opacity-50"
                        >
                          Snooze
                        </button>
                        <button
                          type="button"
                          disabled={busy === item.id}
                          onClick={() =>
                            void run(item.id, () => dismissWaitingItem(item.id), "Dismissed — won't suggest this again")
                          }
                          className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium text-white/60 hover:bg-white/[0.08] disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section className="mt-6" aria-label="Open waiting items">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
                Open ({groups.open.length})
              </h2>
              {groups.open.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-center text-sm text-white/40">
                  Nothing tracked right now. Aura will suggest follow-ups from your email,
                  notes, and captures as they show up.
                </p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {groups.open.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={item.href}
                            className="block truncate text-sm font-medium text-white no-underline hover:text-sky-200"
                          >
                            {item.deliverable}
                          </Link>
                          <p className="mt-0.5 text-xs text-white/50">
                            You asked {item.ownerName} {daysWaiting(item)}d ago · next
                            follow-up {formatDate(item.followUpAt)}
                          </p>
                          {item.suggestedResolution ? (
                            <p className="mt-1 text-xs text-emerald-300/90">
                              A reply suggests this is resolved — review it
                            </p>
                          ) : item.needsReview ? (
                            <p className="mt-1 text-xs text-rose-300/90">
                              Reply needs review
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        <Link
                          href={item.href}
                          className="rounded-full bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white no-underline hover:bg-indigo-400"
                        >
                          Follow up
                        </Link>
                        <button
                          type="button"
                          disabled={busy === item.id}
                          onClick={() =>
                            void run(item.id, () => completeWaitingItem(item.id), "Marked resolved")
                          }
                          className="rounded-full border border-emerald-400/40 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-50"
                        >
                          Resolved
                        </button>
                        <button
                          type="button"
                          disabled={busy === item.id}
                          onClick={() =>
                            void run(item.id, () => snoozeWaitingItem(item.id, { preset: "3d" }), "Snoozed 3 days")
                          }
                          className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/[0.08] disabled:opacity-50"
                        >
                          Snooze
                        </button>
                        <button
                          type="button"
                          disabled={busy === item.id}
                          onClick={() =>
                            void run(item.id, () => dismissWaitingItem(item.id), "Dismissed")
                          }
                          className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium text-white/60 hover:bg-white/[0.08] disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {groups.snoozed.length > 0 && (
              <section className="mt-6" aria-label="Snoozed waiting items">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
                  Snoozed ({groups.snoozed.length})
                </h2>
                <ol className="mt-3 space-y-2">
                  {groups.snoozed.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <Link
                          href={item.href}
                          className="block truncate text-sm text-white/80 no-underline hover:text-white"
                        >
                          {item.deliverable}
                        </Link>
                        <p className="text-xs text-white/40">
                          {item.ownerName} · back {formatDate(item.snoozedUntil)}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy === item.id}
                        onClick={() =>
                          void run(item.id, () => reopenWaitingItem(item.id), "Back on your radar")
                        }
                        className="flex-shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/[0.08] disabled:opacity-50"
                      >
                        Unsnooze
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {groups.history.length > 0 && (
              <section className="mt-6" aria-label="Resolved and dismissed">
                <button
                  type="button"
                  onClick={() => setShowHistory((v) => !v)}
                  className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40 hover:text-white/60"
                >
                  {showHistory ? "Hide" : "Show"} history ({groups.history.length})
                </button>
                {showHistory && (
                  <ol className="mt-3 space-y-2">
                    {groups.history.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.015] px-4 py-2.5"
                      >
                        <div className="min-w-0">
                          <Link
                            href={item.href}
                            className="block truncate text-sm text-white/50 no-underline hover:text-white/80"
                          >
                            {item.deliverable}
                          </Link>
                          <p className="text-xs capitalize text-white/30">
                            {item.ownerName} · {item.status}{" "}
                            {formatDate(item.completedAt ?? item.dismissedAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busy === item.id}
                          onClick={() =>
                            void run(item.id, () => reopenWaitingItem(item.id), "Reopened")
                          }
                          className="flex-shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/60 hover:bg-white/[0.08] disabled:opacity-50"
                        >
                          Reopen
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
