import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, CheckCircle2, Hourglass, Moon, X } from "lucide-react";
import {
  completeAttention,
  completeWaitingItem,
  dismissAttention,
  fetchCheckin,
  getNotificationSettings,
  snoozeAttention,
  type EveningCheckin,
  type EveningCheckinItem,
} from "@/lib/recall-api";
import { useRecallData } from "@/context/RecallDataContext";
import { toast } from "@/hooks/use-toast";

type Props = {
  /** Called after any item action so Today can refresh its briefing/queue. */
  onChanged?: () => void;
};

function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA");
}

function localNowPast(eveningTime: string): boolean {
  const [h, m] = eveningTime.split(":").map((s) => Number(s));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}

const KIND_LABEL: Record<EveningCheckinItem["kind"], string> = {
  deadline: "Deadline",
  appointment: "Meeting",
  task: "Task",
  waiting: "Follow-up",
};

/**
 * Optional evening check-in: what got done, what's still open (with one-tap
 * complete / move-to-tomorrow / dismiss), and a tomorrow preview. Mounted on
 * Today only once the user's configured evening time has passed.
 */
export function EveningCheckinCard({ onChanged }: Props) {
  const { toggleTask, updateTask } = useRecallData();
  const [enabled, setEnabled] = useState(false);
  const [checkin, setCheckin] = useState<EveningCheckin | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCheckin(await fetchCheckin());
    } catch {
      /* check-in is optional — stay hidden on failure */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getNotificationSettings()
      .then((s) => {
        if (cancelled) return;
        if (s.eveningCheckinEnabled && localNowPast(s.eveningCheckinTime)) {
          setEnabled(true);
          void refresh();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function run(item: EveningCheckinItem, action: () => Promise<unknown>, done: string) {
    setBusyId(item.id);
    try {
      await action();
      toast({ title: done, description: item.title });
      await refresh();
      onChanged?.();
    } catch {
      toast({ title: "That didn't save", description: "Try again in a moment.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  if (!enabled || !checkin) return null;
  const nothingOpen =
    checkin.unfinished.length === 0 &&
    checkin.tomorrow.length === 0 &&
    checkin.waitingDue.length === 0 &&
    checkin.completedToday.length === 0;
  if (nothingOpen) return null;

  const tomorrow = tomorrowIso();

  const act = {
    complete: (item: EveningCheckinItem) =>
      run(
        item,
        async () => {
          if (item.kind === "task") toggleTask(item.id);
          else if (item.kind === "waiting") await completeWaitingItem(item.id);
          else await completeAttention(item.id);
        },
        "Done",
      ),
    moveToTomorrow: (item: EveningCheckinItem) =>
      run(
        item,
        async () => {
          if (item.kind === "task") updateTask(item.id, { time: tomorrow });
          else await snoozeAttention(item.id, { until: `${tomorrow}T08:00:00` });
        },
        "Moved to tomorrow",
      ),
    dismiss: (item: EveningCheckinItem) =>
      run(
        item,
        async () => {
          await dismissAttention(item.id);
        },
        "Dismissed",
      ),
  };

  return (
    <section className="rounded-2xl border border-indigo-300/10 bg-indigo-500/[0.04] px-4 py-4">
      <div className="flex items-center gap-2">
        <Moon className="h-4 w-4 text-indigo-300/80" />
        <h2 className="text-sm font-semibold text-white">Evening check-in</h2>
        {checkin.approximateTaskCompletions && (
          <span className="text-[10px] text-white/25">task times approximate</span>
        )}
      </div>

      {checkin.completedToday.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-200/50">
            Done today ({checkin.completedToday.length})
          </p>
          <ul className="mt-1 space-y-0.5">
            {checkin.completedToday.slice(0, 6).map((item) => (
              <li key={`${item.kind}:${item.id}`} className="flex items-center gap-2 text-sm text-white/45">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300/60" />
                <span className="truncate line-through decoration-white/20">{item.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {checkin.unfinished.length > 0 && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/35">
            Still open
          </p>
          <ul className="mt-1 space-y-1">
            {checkin.unfinished.slice(0, 6).map((item) => (
              <li key={`${item.kind}:${item.id}`} className="flex items-center gap-2">
                <Link
                  href={item.href}
                  className="min-w-0 flex-1 truncate text-sm text-zinc-100 no-underline hover:text-white"
                >
                  {item.title}
                  {item.note ? <span className="text-white/35"> — {item.note}</span> : null}
                </Link>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    title="Mark complete"
                    disabled={busyId === item.id}
                    onClick={() => void act.complete(item)}
                    className="rounded-md p-1 text-emerald-300/70 transition-colors hover:bg-emerald-400/10 hover:text-emerald-200 disabled:opacity-40"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  {(item.kind === "task" || item.kind === "deadline") && (
                    <button
                      type="button"
                      title="Move to tomorrow"
                      disabled={busyId === item.id}
                      onClick={() => void act.moveToTomorrow(item)}
                      className="rounded-md p-1 text-sky-300/70 transition-colors hover:bg-sky-400/10 hover:text-sky-200 disabled:opacity-40"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {(item.kind === "deadline" || item.kind === "appointment") && (
                    <button
                      type="button"
                      title="Dismiss"
                      disabled={busyId === item.id}
                      onClick={() => void act.dismiss(item)}
                      className="rounded-md p-1 text-white/30 transition-colors hover:bg-white/10 hover:text-white/60 disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {checkin.tomorrow.length > 0 && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/35">
            Tomorrow
          </p>
          <ul className="mt-1 space-y-0.5">
            {checkin.tomorrow.slice(0, 4).map((item) => (
              <li key={`${item.kind}:${item.id}`} className="text-sm text-white/50">
                <Link href={item.href} className="no-underline hover:text-white/80">
                  <span className="text-white/25">{KIND_LABEL[item.kind]} · </span>
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {checkin.waitingDue.length > 0 && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/35">
            Follow-ups due
          </p>
          <ul className="mt-1 space-y-0.5">
            {checkin.waitingDue.slice(0, 3).map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <Hourglass className="h-3.5 w-3.5 shrink-0 text-violet-300/70" />
                <Link href={item.href} className="min-w-0 flex-1 truncate text-zinc-200 no-underline hover:text-white">
                  {item.title}
                  {item.note ? <span className="text-white/35"> — {item.note}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
