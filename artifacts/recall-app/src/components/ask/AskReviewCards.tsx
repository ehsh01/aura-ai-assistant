import { useState } from "react";
import {
  AlarmClock,
  CalendarClock,
  Check,
  FileText,
  Inbox,
  ListTodo,
  Pencil,
  Sparkles,
  X,
} from "lucide-react";
import {
  confirmAskAction,
  cancelAskAction,
  type AskActionType,
  type AskProposedAction,
  type AskProposedActionDraft,
  type AskEntityLinks,
  type AskEntityResolution,
} from "@/lib/recall-api";

type CardStatus = "idle" | "editing" | "saving" | "saved" | "dismissed" | "error";

const TYPE_META: Record<
  AskActionType,
  { accent: string; badge: string; icon: typeof ListTodo; saveLabel: string }
> = {
  create_task: {
    accent: "border-l-indigo-400",
    badge: "bg-indigo-500/15 text-indigo-200",
    icon: ListTodo,
    saveLabel: "Add task",
  },
  create_reminder: {
    accent: "border-l-amber-400",
    badge: "bg-amber-500/15 text-amber-200",
    icon: AlarmClock,
    saveLabel: "Set reminder",
  },
  save_memory: {
    accent: "border-l-violet-400",
    badge: "bg-violet-500/15 text-violet-200",
    icon: Sparkles,
    saveLabel: "Save",
  },
  create_note: {
    accent: "border-l-sky-400",
    badge: "bg-sky-500/15 text-sky-200",
    icon: FileText,
    saveLabel: "Save note",
  },
  send_to_inbox: {
    accent: "border-l-slate-400",
    badge: "bg-slate-500/15 text-slate-200",
    icon: Inbox,
    saveLabel: "Send to Inbox",
  },
  create_calendar_event: {
    accent: "border-l-emerald-400",
    badge: "bg-emerald-500/15 text-emerald-200",
    icon: CalendarClock,
    saveLabel: "Add to calendar",
  },
};

function confidenceLabel(score: number): string {
  if (score >= 0.8) return "High";
  if (score >= 0.5) return "Medium";
  return "Low";
}

/** One hour from now (ISO) — matches the backend default when no date was detected. */
function defaultReminderDateTime(): string {
  return new Date(Date.now() + 60 * 60_000).toISOString();
}

/** Date-only strings mean "noon local", matching the backend's dueAtFromDateString convention. */
function parseDueAtLocal(dueAt: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueAt);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0, 0);
  }
  const parsed = new Date(dueAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Value for <input type="datetime-local">. */
function toDateTimeInputValue(dueAt: string): string {
  const d = parseDueAtLocal(dueAt);
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Reverse of toDateTimeInputValue — sends a full ISO string back to the server. */
function fromDateTimeInputValue(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Human-friendly due label for the read-only chip; date-only stays unambiguous. */
function formatDueAtChip(dueAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) return dueAt;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return dueAt;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ReviewCard({
  action,
  rawCaptureId,
  threadId,
  linkOverride,
  onConfirmed,
}: {
  action: AskProposedAction;
  rawCaptureId: string | null;
  threadId: string | null;
  /** Links chosen by the user when Aura could not tell two records apart. */
  linkOverride?: { personId: string | null; projectId: string | null };
  onConfirmed?: (result: { entityType: string }) => void;
}) {
  const [status, setStatus] = useState<CardStatus>("idle");
  // Reminders need a time to be visible on Today; prefill the same 1-hour
  // default the backend applies, so the card preview matches what gets saved.
  const [draft, setDraft] = useState<AskProposedActionDraft>(() =>
    action.type === "create_reminder" && !action.draft.dueAt
      ? { ...action.draft, dueAt: defaultReminderDateTime() }
      : action.draft,
  );
  const [error, setError] = useState<string | null>(null);
  const [savedAs, setSavedAs] = useState<string | null>(null);

  const meta = TYPE_META[action.type];
  const Icon = meta.icon;

  const run = async (type: AskActionType) => {
    setStatus("saving");
    setError(null);
    try {
      const result = await confirmAskAction({
        type,
        draft: {
          ...draft,
          personId: linkOverride?.personId ?? draft.personId ?? null,
          projectId: linkOverride?.projectId ?? draft.projectId ?? null,
        },
        rawCaptureId,
        threadId,
        // Durable proposals use aprop-*; ephemeral plan cards still confirm by draft.
        proposalId: action.id.startsWith("aprop-") ? action.id : null,
      });
      setStatus("saved");
      setSavedAs(result.entityType === "attention_item" ? "reminder" : result.entityType);
      onConfirmed?.({ entityType: result.entityType });
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
    }
  };

  if (status === "dismissed") return null;

  if (status === "saved") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
        <Check size={16} className="text-emerald-400" />
        <span>
          {meta.saveLabel} · saved{savedAs ? ` as ${savedAs.replace(/_/g, " ")}` : ""}
        </span>
      </div>
    );
  }

  const editing = status === "editing";

  return (
    <div
      className={`rounded-2xl border border-l-4 border-white/10 bg-white/[0.04] p-4 ${meta.accent}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-white/90">
          <Icon size={16} className="opacity-90" />
          {action.label}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${meta.badge}`}>
          Confidence: {confidenceLabel(action.confidence)}
        </span>
      </div>

      {editing ? (
        <div className="space-y-2">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
            placeholder="Title"
          />
          <textarea
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            rows={3}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 outline-none"
            placeholder="Details"
          />
          {action.type === "create_reminder" && (
            <input
              type="datetime-local"
              value={draft.dueAt ? toDateTimeInputValue(draft.dueAt) : ""}
              onChange={(e) => setDraft({ ...draft, dueAt: fromDateTimeInputValue(e.target.value) })}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 outline-none [color-scheme:dark]"
            />
          )}
          {action.type === "create_task" && (
            <input
              value={draft.dueAt ?? ""}
              onChange={(e) => setDraft({ ...draft, dueAt: e.target.value || null })}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 outline-none"
              placeholder="Due date (YYYY-MM-DD)"
            />
          )}
        </div>
      ) : (
        <>
          <p className="text-base text-white/90">“{draft.title}”</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/45">
            {draft.dueAt && (
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-white/70">
                {formatDueAtChip(draft.dueAt)}
              </span>
            )}
            {draft.priority !== "medium" && <span>Priority: {draft.priority}</span>}
            {action.reason && <span className="italic">· {action.reason}</span>}
          </div>
        </>
      )}

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={status === "saving"}
          onClick={() => void run(action.type)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
        >
          <Check size={14} />
          {status === "saving" ? "Saving…" : meta.saveLabel}
        </button>

        <button
          type="button"
          disabled={status === "saving"}
          onClick={() => setStatus(editing ? "idle" : "editing")}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-sm text-white/80 hover:bg-white/5 disabled:opacity-50"
        >
          <Pencil size={14} />
          {editing ? "Done" : "Edit"}
        </button>

        {action.type !== "send_to_inbox" && (
          <button
            type="button"
            disabled={status === "saving"}
            onClick={() => void run("send_to_inbox")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-sm text-white/80 hover:bg-white/5 disabled:opacity-50"
          >
            <Inbox size={14} />
            Send to Inbox
          </button>
        )}

        <button
          type="button"
          disabled={status === "saving"}
          onClick={() => {
            setStatus("dismissed");
            if (action.id.startsWith("aprop-")) {
              void cancelAskAction(action.id).catch(() => {
                /* best-effort server cancel */
              });
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-sm text-white/50 hover:bg-white/5 disabled:opacity-50"
        >
          <X size={14} />
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** Asks which record was meant when a mention matched more than one. */
function ClarifyLink({
  resolution,
  chosenId,
  onChoose,
}: {
  resolution: AskEntityResolution;
  chosenId: string | null;
  onChoose: (id: string) => void;
}) {
  if (resolution.status !== "ambiguous" || !resolution.question) return null;
  return (
    <div className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.07] px-4 py-3">
      <p className="text-sm text-amber-100/90">{resolution.question}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {resolution.candidates.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => onChoose(candidate.id)}
            aria-pressed={chosenId === candidate.id}
            className={`rounded-xl px-3 py-1.5 text-xs transition-colors ${
              chosenId === candidate.id
                ? "bg-amber-400 font-medium text-zinc-900"
                : "border border-white/10 text-white/70 hover:bg-white/5"
            }`}
          >
            {candidate.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Inline review cards for a captured Ask input (task/reminder/memory/note). */
export function AskReviewCards({
  actions,
  rawCaptureId,
  threadId,
  links,
  onConfirmed,
}: {
  actions: AskProposedAction[];
  rawCaptureId: string | null;
  threadId: string | null;
  links?: AskEntityLinks;
  onConfirmed?: (result: { entityType: string }) => void;
}) {
  const [personId, setPersonId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  if (actions.length === 0) return null;
  return (
    <div className="mx-auto w-full max-w-lg space-y-3 text-left">
      {links?.person && (
        <ClarifyLink resolution={links.person} chosenId={personId} onChoose={setPersonId} />
      )}
      {links?.project && (
        <ClarifyLink resolution={links.project} chosenId={projectId} onChoose={setProjectId} />
      )}
      {actions.map((action) => (
        <ReviewCard
          key={action.id}
          action={action}
          rawCaptureId={rawCaptureId}
          threadId={threadId}
          linkOverride={{ personId, projectId }}
          onConfirmed={onConfirmed}
        />
      ))}
    </div>
  );
}
