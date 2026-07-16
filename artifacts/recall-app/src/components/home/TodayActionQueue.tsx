import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Flame, Hourglass, Inbox, Target, X } from "lucide-react";
import type { BriefingItem, FocusNow, WaitingItem } from "@/lib/home-briefing";
import { createWaitingFollowUp, dismissWaitingOn } from "@/lib/recall-api";
import { rememberDismissedWaitingId } from "@/lib/waiting-dismissals";
import { toast } from "@/hooks/use-toast";

export type QueueItem = {
  id: string;
  kind: "homey" | "focus" | "waiting" | "critical" | "inbox";
  title: string;
  detail: string;
  href: string;
  waiting?: WaitingItem;
};

type Props = {
  items: QueueItem[];
  onWaitingChanged?: () => void;
};

const KIND_META: Record<
  QueueItem["kind"],
  { label: string; icon: typeof Target; className: string }
> = {
  homey: { label: "Home", icon: Flame, className: "text-amber-300" },
  focus: { label: "Do now", icon: Target, className: "text-indigo-300" },
  waiting: { label: "Waiting", icon: Hourglass, className: "text-sky-300" },
  critical: { label: "Urgent", icon: Flame, className: "text-rose-300" },
  inbox: { label: "Inbox", icon: Inbox, className: "text-violet-300" },
};

function waitLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

/** Ranked, deduped action list for Today — one place to decide what to do. */
export function buildTodayQueue(input: {
  focus: FocusNow | null;
  waiting: WaitingItem[];
  critical: BriefingItem[];
  reminders: BriefingItem[];
  limit?: number;
}): QueueItem[] {
  const limit = input.limit ?? 7;
  const out: QueueItem[] = [];
  const seen = new Set<string>();

  const push = (item: QueueItem) => {
    const key = item.href + "|" + item.title.toLowerCase();
    if (seen.has(item.id) || seen.has(key)) return;
    seen.add(item.id);
    seen.add(key);
    out.push(item);
  };

  for (const c of input.critical) {
    if (!/homey/i.test(c.label)) continue;
    push({
      id: `homey:${c.id}`,
      kind: "homey",
      title: c.label.replace(/^Homey( emergency)?:\s*/i, ""),
      detail: "Needs attention at home",
      href: c.href,
    });
  }

  if (input.focus) {
    push({
      id: `focus:${input.focus.href}`,
      kind: "focus",
      title: input.focus.title,
      detail: input.focus.reason,
      href: input.focus.href,
    });
  }

  for (const w of input.waiting) {
    push({
      id: w.id,
      kind: "waiting",
      title: w.item,
      detail: `${w.person} · waiting ${waitLabel(w.days)}`,
      href: w.href,
      waiting: w,
    });
  }

  for (const c of input.critical) {
    if (/homey/i.test(c.label)) continue;
    push({
      id: `crit:${c.id}`,
      kind: "critical",
      title: c.label,
      detail: "Urgent",
      href: c.href,
    });
  }

  for (const r of input.reminders) {
    push({
      id: `inbox:${r.id}`,
      kind: "inbox",
      title: r.label,
      detail: "Review in inbox",
      href: r.href,
    });
  }

  return out.slice(0, limit);
}

export function TodayActionQueue({ items, onWaitingChanged }: Props) {
  const [, navigate] = useLocation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());

  const visible = useMemo(
    () => items.filter((item) => !hiddenIds.has(item.id)),
    [items, hiddenIds],
  );

  const followUp = async (item: WaitingItem) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      const res = await createWaitingFollowUp(item.id);
      toast({ title: "Follow-up task created", description: res.task.title });
      setHiddenIds((prev) => new Set(prev).add(item.id));
      onWaitingChanged?.();
      navigate(`/tasks?task=${encodeURIComponent(res.task.id)}`);
    } catch (err) {
      toast({
        title: "Could not create follow-up",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (item: WaitingItem) => {
    if (busyId) return;
    setBusyId(item.id);
    // Hide immediately and persist locally so a refresh never resurrects it
    // even if /home briefly falls back or lags behind the dismiss write.
    rememberDismissedWaitingId(item.id);
    setHiddenIds((prev) => new Set(prev).add(item.id));
    try {
      await dismissWaitingOn(item.id);
      toast({ title: "Dismissed", description: "Won’t show this waiting item again." });
      onWaitingChanged?.();
    } catch (err) {
      toast({
        title: "Could not dismiss",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  if (visible.length === 0) {
    return (
      <section className="nebula-glass rounded-2xl px-5 py-8 text-center">
        <p className="text-base font-medium text-white/80">Clear.</p>
        <p className="mt-1 text-sm text-white/40">
          Nothing needs you right now. Capture below if something comes up.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="What to do next">
      <ol className="space-y-2">
        {visible.map((item, index) => {
          const meta = KIND_META[item.kind];
          const Icon = meta.icon;
          return (
            <li
              key={item.id}
              className="nebula-glass flex items-center gap-3 rounded-2xl px-4 py-3.5"
            >
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xs font-semibold text-white/50">
                {index + 1}
              </span>
              <Link
                href={item.href}
                className="flex min-w-0 flex-1 items-center gap-3 no-underline"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-1.5">
                    <Icon size={12} className={meta.className} />
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${meta.className}`}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="truncate text-sm font-medium text-white">{item.title}</p>
                  <p className="truncate text-xs text-white/40">{item.detail}</p>
                </div>
                <ArrowRight
                  size={16}
                  className="hidden flex-shrink-0 text-white/20 sm:block"
                />
              </Link>
              {item.waiting && (
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void dismiss(item.waiting!)}
                    disabled={busyId === item.waiting.id}
                    title="Dismiss"
                    aria-label={`Dismiss ${item.title}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/70 hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
                  >
                    <X size={15} strokeWidth={2.25} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void followUp(item.waiting!)}
                    disabled={busyId === item.waiting.id}
                    className="rounded-full bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
                  >
                    {busyId === item.waiting.id ? "…" : "Follow up"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
