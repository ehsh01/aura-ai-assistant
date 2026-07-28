import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Bell, Check, Hourglass, Inbox, X } from "lucide-react";
import {
  confirmAttention,
  confirmWaitingCandidate,
  dismissAttention,
  dismissWaitingItem,
  type BriefingReview,
  type ReviewQueue,
  type ReviewQueueItem,
} from "@/lib/recall-api";
import { acceptCapture, updateCapture } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";

const QUEUE_META: Record<
  ReviewQueue,
  { label: string; icon: typeof Hourglass; className: string; href: string }
> = {
  waiting: { label: "Waiting", icon: Hourglass, className: "text-violet-300", href: "/waiting" },
  deadline: { label: "Deadline", icon: Bell, className: "text-orange-300", href: "/deadlines" },
  inbox: { label: "Inbox", icon: Inbox, className: "text-sky-300", href: "/inbox" },
};

type Props = {
  review: BriefingReview;
  onChanged?: () => void;
};

async function confirmItem(item: ReviewQueueItem): Promise<void> {
  if (item.queue === "waiting") {
    await confirmWaitingCandidate(item.id);
  } else if (item.queue === "deadline") {
    await confirmAttention(item.id);
  } else {
    await acceptCapture(item.id);
  }
}

async function dismissItem(item: ReviewQueueItem): Promise<void> {
  if (item.queue === "waiting") {
    await dismissWaitingItem(item.id);
  } else if (item.queue === "deadline") {
    await dismissAttention(item.id);
  } else {
    await updateCapture(item.id, { status: "dismissed" });
  }
}

/** Compact roll-up of every place Aura is waiting on a user confirmation. */
export function NeedsReviewStrip({ review, onChanged }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());

  const visible = useMemo(
    () => review.items.filter((item) => !hiddenIds.has(item.id)),
    [review.items, hiddenIds],
  );

  if (review.total === 0 || visible.length === 0) return null;

  const run = async (item: ReviewQueueItem, action: "confirm" | "dismiss") => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      if (action === "confirm") {
        await confirmItem(item);
        toast({ title: "Confirmed" });
      } else {
        await dismissItem(item);
        toast({ title: "Dismissed" });
      }
      setHiddenIds((prev) => new Set(prev).add(item.id));
      onChanged?.();
    } catch (err) {
      toast({
        title: "That didn't work",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const remaining = review.total - visible.length;
  const fullestQueue: ReviewQueue =
    review.waitingCandidates >= review.unconfirmedDeadlines &&
    review.waitingCandidates >= review.inboxPending
      ? "waiting"
      : review.unconfirmedDeadlines >= review.inboxPending
        ? "deadline"
        : "inbox";

  return (
    <section aria-label="Needs your confirmation" className="space-y-2">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-300/80">
        Aura needs your confirmation ({review.total})
      </p>
      <ol className="space-y-2">
        {visible.map((item) => {
          const meta = QUEUE_META[item.queue];
          const Icon = meta.icon;
          return (
            <li
              key={`${item.queue}:${item.id}`}
              className="nebula-glass flex items-center gap-3 rounded-2xl px-4 py-3"
            >
              <Link href={item.href} className="flex min-w-0 flex-1 items-center gap-3 no-underline">
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-1.5">
                    <Icon size={12} className={meta.className} />
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <p className="truncate text-sm font-medium text-white">{item.title}</p>
                  <p className="truncate text-xs text-white/40">{item.detail}</p>
                </div>
              </Link>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void run(item, "dismiss")}
                  disabled={busyId === item.id}
                  title="Dismiss"
                  aria-label={`Dismiss ${item.title}`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/70 hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
                >
                  <X size={15} strokeWidth={2.25} />
                </button>
                <button
                  type="button"
                  onClick={() => void run(item, "confirm")}
                  disabled={busyId === item.id}
                  title="Confirm"
                  aria-label={`Confirm ${item.title}`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-50"
                >
                  <Check size={15} strokeWidth={2.5} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {remaining > 0 && (
        <Link
          href={QUEUE_META[fullestQueue].href}
          className="block px-1 text-xs text-white/40 no-underline hover:text-white/60"
        >
          {remaining} more waiting for review →
        </Link>
      )}
    </section>
  );
}
