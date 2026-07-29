import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Bell, Calendar, Camera, CheckSquare, Hourglass, Sun, X, Zap } from "lucide-react";
import type { BriefingAction, BriefingActionKind, MorningBriefing } from "@/lib/recall-api";

type Props = {
  briefing: MorningBriefing;
  /** IDs already actionable in the TodayActionQueue below — never double-surfaced. */
  queuedIds: ReadonlySet<string>;
  userName: string;
};

const KIND_META: Record<BriefingActionKind, { label: string; icon: typeof Bell; className: string }> = {
  deadline: { label: "Deadline", icon: Bell, className: "text-orange-300" },
  appointment: { label: "Meeting", icon: Calendar, className: "text-sky-300" },
  waiting: { label: "Follow-up", icon: Hourglass, className: "text-violet-300" },
  task: { label: "Task", icon: CheckSquare, className: "text-emerald-300" },
  capture: { label: "Capture", icon: Camera, className: "text-zinc-300" },
};

const FOCUS_DISMISS_PREFIX = "recall.focusWindow.dismissed.";

function focusDismissKey(date: string): string {
  return `${FOCUS_DISMISS_PREFIX}${date}`;
}

function readFocusDismissed(date: string): boolean {
  try {
    return localStorage.getItem(focusDismissKey(date)) === "1";
  } catch {
    return false;
  }
}

function writeFocusDismissed(date: string): void {
  try {
    localStorage.setItem(focusDismissKey(date), "1");
  } catch {
    /* storage unavailable — dismiss state just won't persist */
  }
}

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function ActionRow({ action }: { action: BriefingAction }) {
  const meta = KIND_META[action.kind];
  const Icon = meta.icon;
  return (
    <li>
      <Link
        href={action.href}
        className="flex items-start gap-3 rounded-xl px-2 py-2 no-underline transition-colors hover:bg-white/[0.04]"
      >
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.className}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-zinc-100">{action.title}</span>
          <span className="block text-xs text-white/40">
            {action.reason}
            <span className="text-white/25"> · {action.sourceLabel}</span>
          </span>
        </span>
        <span className={`mt-1 shrink-0 text-[10px] font-semibold uppercase tracking-wider ${meta.className}`}>
          {meta.label}
        </span>
      </Link>
    </li>
  );
}

/** Structured morning briefing — schedule, top source-explained actions, focus gap. */
export function MorningBriefingCard({ briefing, queuedIds, userName }: Props) {
  const [focusDismissed, setFocusDismissed] = useState(() =>
    readFocusDismissed(briefing.date),
  );
  useEffect(() => {
    setFocusDismissed(readFocusDismissed(briefing.date));
  }, [briefing.date]);

  const actions = useMemo(
    () => briefing.actions.filter((a) => !queuedIds.has(a.id)),
    [briefing.actions, queuedIds],
  );

  const greeting = greetingFor(new Date().getHours());
  const showFocus = briefing.focusWindow && !focusDismissed;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
      <div className="flex items-center gap-2">
        <Sun className="h-4 w-4 text-amber-200/80" />
        <h2 className="text-sm font-semibold text-white">
          {greeting}{userName ? `, ${userName}` : ""}
        </h2>
      </div>
      <p className="mt-1 text-sm text-white/55">{briefing.summary}</p>

      {briefing.calendarToday.length > 0 && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/35">
            On your calendar
          </p>
          <ul className="mt-1.5 space-y-1">
            {briefing.calendarToday.map((c) => (
              <li key={c.id} className="flex items-baseline gap-2 text-sm">
                <span className="w-20 shrink-0 text-right text-xs tabular-nums text-sky-200/70">
                  {c.startLabel ?? "All day"}
                </span>
                <Link
                  href={c.href}
                  className="min-w-0 flex-1 truncate text-zinc-200 no-underline hover:text-white"
                >
                  {c.title}
                  {c.location ? <span className="text-white/30"> · {c.location}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {actions.length > 0 && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/35">
            Top actions
          </p>
          <ul className="mt-1 space-y-0.5">
            {actions.map((a) => (
              <ActionRow key={`${a.kind}:${a.id}`} action={a} />
            ))}
          </ul>
        </div>
      )}

      {showFocus && briefing.focusWindow && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-indigo-400/15 bg-indigo-500/[0.06] px-3 py-2">
          <Zap className="h-3.5 w-3.5 shrink-0 text-indigo-300" />
          <p className="min-w-0 flex-1 text-xs text-indigo-100/80">
            <span className="font-semibold text-indigo-100">
              Focus window {briefing.focusWindow.label}
            </span>
            {" — "}
            {briefing.focusWindow.reason}
          </p>
          <button
            type="button"
            aria-label="Dismiss focus window for today"
            className="shrink-0 rounded-md p-1 text-white/30 transition-colors hover:bg-white/10 hover:text-white/70"
            onClick={() => {
              writeFocusDismissed(briefing.date);
              setFocusDismissed(true);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {briefing.dataNotes.length > 0 && (
        <ul className="mt-3 space-y-0.5">
          {briefing.dataNotes.map((note) => (
            <li key={note} className="text-xs text-amber-200/50">
              {note}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
