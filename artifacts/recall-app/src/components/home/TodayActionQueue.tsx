import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Bell, Flame, Hourglass, Inbox, Target, X } from "lucide-react";
import type { BriefingItem, FocusNow, WaitingItem } from "@/lib/home-briefing";
import type { AttentionItemRecord } from "@/lib/recall-api";
import {
  createWaitingFollowUp,
  dismissAttention,
  dismissWaitingOn,
  markAttentionSeen,
  snoozeAttention,
} from "@/lib/recall-api";
import { rememberDismissedWaitingId } from "@/lib/waiting-dismissals";
import { toast } from "@/hooks/use-toast";

export type QueueItem = {
  id: string;
  kind: "homey" | "focus" | "waiting" | "critical" | "inbox" | "attention";
  title: string;
  detail: string;
  href: string;
  waiting?: WaitingItem;
  attention?: AttentionItemRecord;
};

type Props = {
  items: QueueItem[];
  onWaitingChanged?: () => void;
  onAttentionChanged?: () => void;
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
  attention: { label: "Deadline", icon: Bell, className: "text-orange-300" },
};

function waitLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function dueDetail(item: AttentionItemRecord): string {
  const due = new Date(item.dueAt);
  const now = new Date();
  const dayMs = 86_400_000;
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startDue = new Date(due);
  startDue.setHours(0, 0, 0, 0);
  const days = Math.round((startDue.getTime() - startToday.getTime()) / dayMs);
  const when =
    days < 0
      ? `${Math.abs(days)}d overdue`
      : days === 0
        ? "due today"
        : days === 1
          ? "due tomorrow"
          : `due in ${days}d`;
  const kind =
    item.kind === "appointment"
      ? "Appointment"
      : item.kind === "follow_up"
        ? "Follow-up"
        : "Deadline";
  const seen = item.status === "seen" || item.seenAt ? " · seen" : "";
  return `${kind} · ${when}${seen}`;
}

function attentionScore(item: AttentionItemRecord, now: Date): number {
  const due = Date.parse(item.dueAt);
  const hours = (due - now.getTime()) / 3_600_000;
  let score = 0;
  if (hours < 0) score += 100 - Math.min(48, Math.abs(hours));
  else if (hours <= 48) score += 80 - hours / 2;
  else if (hours <= 24 * 7) score += 40 - hours / 24;
  else score += 10;
  if (item.status === "open" && !item.seenAt) score += 8;
  return score;
}

/** Ranked, deduped action list for Today — one place to decide what to do. */
export function buildTodayQueue(input: {
  focus: FocusNow | null;
  waiting: WaitingItem[];
  critical: BriefingItem[];
  reminders: BriefingItem[];
  attention?: AttentionItemRecord[];
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

  const now = new Date();
  const attentionSorted = [...(input.attention ?? [])].sort(
    (a, b) => attentionScore(b, now) - attentionScore(a, now),
  );
  for (const a of attentionSorted) {
    push({
      id: `attn:${a.id}`,
      kind: "attention",
      title: a.title,
      detail: dueDetail(a),
      href: a.href || `/ask?q=${encodeURIComponent(a.title.slice(0, 80))}`,
      attention: a,
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

export function TodayActionQueue({
  items,
  onWaitingChanged,
  onAttentionChanged,
}: Props) {
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

  const attnSeen = async (item: AttentionItemRecord) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      await markAttentionSeen(item.id);
      toast({ title: "Marked seen", description: "Still on Today until the date." });
      onAttentionChanged?.();
    } catch (err) {
      toast({
        title: "Could not mark seen",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const attnDismiss = async (item: AttentionItemRecord) => {
    if (busyId) return;
    setBusyId(item.id);
    setHiddenIds((prev) => new Set(prev).add(`attn:${item.id}`));
    try {
      await dismissAttention(item.id);
      toast({ title: "Dismissed", description: "Won’t remind you about this again." });
      onAttentionChanged?.();
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

  const attnSnooze = async (item: AttentionItemRecord) => {
    if (busyId) return;
    setBusyId(item.id);
    setHiddenIds((prev) => new Set(prev).add(`attn:${item.id}`));
    try {
      await snoozeAttention(item.id, { preset: "1d_before" });
      toast({
        title: "Remind closer to date",
        description: "We’ll surface this again 1 day before.",
      });
      onAttentionChanged?.();
    } catch (err) {
      toast({
        title: "Could not snooze",
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
              {item.attention && (
                <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => void attnDismiss(item.attention!)}
                    disabled={busyId === item.attention.id}
                    title="Dismiss"
                    aria-label={`Dismiss ${item.title}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/70 hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
                  >
                    <X size={15} strokeWidth={2.25} />
                  </button>
                  {item.attention.status !== "seen" && !item.attention.seenAt && (
                    <button
                      type="button"
                      onClick={() => void attnSeen(item.attention!)}
                      disabled={busyId === item.attention.id}
                      className="rounded-full border border-white/20 px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/[0.08] disabled:opacity-50"
                    >
                      Seen
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void attnSnooze(item.attention!)}
                    disabled={busyId === item.attention.id}
                    className="rounded-full bg-orange-500/90 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-orange-400 disabled:opacity-50"
                  >
                    {busyId === item.attention.id ? "…" : "1d before"}
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
