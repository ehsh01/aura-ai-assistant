import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { listProjects } from "@workspace/api-client-react";
import { AppLayout } from "@/components/AppLayout";
import { toast } from "@/hooks/use-toast";
import { useRecallData } from "@/context/RecallDataContext";
import {
  completeAttention,
  confirmAttention,
  dismissAttention,
  getAttentionItem,
  listDeadlines,
  listOrganizations,
  listPeople,
  listWaitingItems,
  patchAttention,
  reopenAttention,
  scanAttention,
  snoozeAttention,
  type AttentionItemDetail,
  type AttentionItemRecord,
  type DeadlinesOverview,
  type OrganizationRecord,
  type PersonRecord,
  type WaitingItemRecord,
} from "@/lib/recall-api";
import type { RecallProject } from "@/lib/recall-context";

const STATUS_STYLE: Record<AttentionItemRecord["status"], string> = {
  open: "bg-sky-500/15 text-sky-300 border-sky-400/30",
  seen: "bg-indigo-500/15 text-indigo-300 border-indigo-400/30",
  snoozed: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  completed: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  dismissed: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

const KIND_LABEL: Record<AttentionItemRecord["kind"], string> = {
  deadline: "Deadline",
  appointment: "Appointment",
  follow_up: "Follow-up",
  other: "Reminder",
};

const AUDIT_LABEL: Record<string, string> = {
  attention_created: "Tracked",
  attention_updated: "Corrected",
  attention_confirmed: "Date confirmed",
  attention_snoozed: "Snoozed",
  attention_dismissed: "Dismissed",
  attention_completed: "Completed",
  attention_reopened: "Reopened",
};

type GroupKey = Exclude<keyof DeadlinesOverview, "recentTerminal"> | "recentTerminal";

const GROUPS: { key: GroupKey; label: string; hint?: string }[] = [
  { key: "unconfirmed", label: "Confirm these dates", hint: "Vague dates from your sources — confirm or correct them." },
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "thisWeek", label: "This week" },
  { key: "later", label: "Later" },
  { key: "snoozed", label: "Snoozed" },
  { key: "recentTerminal", label: "Recently closed" },
];

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sourceHref(item: AttentionItemRecord): { href: string; label: string } | null {
  const meta = item.metadata ?? {};
  if (typeof meta.sourceUrl === "string" && meta.sourceUrl) {
    return { href: meta.sourceUrl, label: "Open in Gmail" };
  }
  if (item.sourceEntityType === "note") {
    return { href: `/notes?note=${encodeURIComponent(item.sourceEntityId)}`, label: "Open note" };
  }
  if (item.sourceEntityType === "capture_item" || item.sourceEntityType === "capture") {
    return { href: `/inbox?capture=${encodeURIComponent(item.sourceEntityId)}`, label: "Open capture" };
  }
  return null;
}

export function Deadlines() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const selectedId = useMemo(
    () => new URLSearchParams(search).get("item"),
    [search],
  );

  const { tasks } = useRecallData();
  const [overview, setOverview] = useState<DeadlinesOverview | null>(null);
  const [detail, setDetail] = useState<AttentionItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [projects, setProjects] = useState<RecallProject[]>([]);
  const [orgs, setOrgs] = useState<OrganizationRecord[]>([]);
  const [waitingItems, setWaitingItems] = useState<WaitingItemRecord[]>([]);

  // Editable fields (every extracted field is correctable).
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [kind, setKind] = useState<AttentionItemRecord["kind"]>("deadline");
  const [dateConfidence, setDateConfidence] = useState<"certain" | "uncertain">("certain");
  const [timeZone, setTimeZone] = useState("");
  const [personId, setPersonId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [waitingItemId, setWaitingItemId] = useState("");

  const applyItem = useCallback((item: AttentionItemRecord) => {
    setTitle(item.title);
    setSummary(item.summary ?? "");
    setDueAt(toDateInput(item.dueAt));
    setKind(item.kind);
    setDateConfidence(item.dateConfidence ?? "certain");
    setTimeZone(item.timeZone ?? "");
    setPersonId(item.personId ?? "");
    setProjectId(item.projectId ?? "");
    setTaskId(item.taskId ?? "");
    setOrganizationId(item.organizationId ?? "");
    setWaitingItemId(item.waitingItemId ?? "");
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await listDeadlines();
      setOverview(res);
    } catch (err) {
      toast({
        title: "Could not load deadlines",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    try {
      const res = await getAttentionItem(selectedId);
      setDetail(res);
      applyItem(res);
    } catch {
      setDetail(null);
    }
  }, [selectedId, applyItem]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void reloadDetail();
  }, [reloadDetail]);

  useEffect(() => {
    void listPeople().then((r) => setPeople(r.people)).catch(() => {});
    void listProjects().then((r) => setProjects(r.projects as RecallProject[])).catch(() => {});
    void listOrganizations().then((r) => setOrgs(r.organizations)).catch(() => {});
    void listWaitingItems({ status: "open" }).then((r) => setWaitingItems(r.items)).catch(() => {});
  }, []);

  const item = detail;

  const dirty = useMemo(() => {
    if (!item) return false;
    return (
      title !== item.title ||
      summary !== (item.summary ?? "") ||
      dueAt !== toDateInput(item.dueAt) ||
      kind !== item.kind ||
      dateConfidence !== (item.dateConfidence ?? "certain") ||
      timeZone !== (item.timeZone ?? "") ||
      personId !== (item.personId ?? "") ||
      projectId !== (item.projectId ?? "") ||
      taskId !== (item.taskId ?? "") ||
      organizationId !== (item.organizationId ?? "") ||
      waitingItemId !== (item.waitingItemId ?? "")
    );
  }, [item, title, summary, dueAt, kind, dateConfidence, timeZone, personId, projectId, taskId, organizationId, waitingItemId]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await reload();
      await reloadDetail();
    } catch (err) {
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run("save", () =>
      patchAttention(selectedId!, {
        title,
        summary: summary || null,
        dueAt: dueAt || null,
        kind,
        dateConfidence,
        timeZone: timeZone || null,
        personId: personId || null,
        projectId: projectId || null,
        taskId: taskId || null,
        organizationId: organizationId || null,
        waitingItemId: waitingItemId || null,
      }),
    );

  const scanNow = () =>
    run("scan", async () => {
      await scanAttention();
      toast({ title: "Scan started", description: "New deadlines will appear shortly." });
    });

  const select = (id: string) => {
    navigate(`/deadlines?item=${encodeURIComponent(id)}`);
  };

  const totalActive = overview
    ? overview.unconfirmed.length +
      overview.overdue.length +
      overview.today.length +
      overview.thisWeek.length +
      overview.later.length
    : 0;

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#0a0a0f] p-4 md:p-8 text-white">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">Command center</p>
              <h1 className="mt-2 text-3xl font-semibold">Deadlines</h1>
              <p className="mt-2 text-white/50">
                Dates Aura found in your email, captures, and notes. Every one traces back to its
                source — correct anything.
              </p>
            </div>
            <ActionButton busy={busy === "scan"} onClick={scanNow} label="Scan Gmail + calendar" />
          </div>

          {loading || !overview ? (
            <div className="mt-8 text-white/40">Loading deadlines...</div>
          ) : (
            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_420px]">
              {/* Grouped list */}
              <div className="space-y-6">
                {totalActive === 0 && (
                  <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <p className="text-sm text-white/60">
                      No deadlines tracked yet. Scan Gmail, or capture a note with a date and Aura
                      will pick it up.
                    </p>
                  </section>
                )}
                {GROUPS.map((group) => {
                  const items = overview[group.key];
                  if (!items.length) return null;
                  return (
                    <section key={group.key}>
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">
                        {group.label}
                        <span className="ml-2 text-white/30">{items.length}</span>
                      </h2>
                      {group.hint && (
                        <p className="mt-1 text-xs text-white/35">{group.hint}</p>
                      )}
                      <ul className="mt-2 space-y-2">
                        {items.map((row) => (
                          <li key={row.id}>
                            <button
                              type="button"
                              onClick={() => select(row.id)}
                              className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                                selectedId === row.id
                                  ? "border-indigo-400/60 bg-indigo-500/10"
                                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="truncate text-sm font-medium text-white">
                                  {row.title}
                                </span>
                                <span
                                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLE[row.status]}`}
                                >
                                  {row.status}
                                </span>
                              </div>
                              <p className="mt-1 truncate text-xs text-white/45">
                                {KIND_LABEL[row.kind]} · {row.dueReason?.label ?? formatDateTime(row.dueAt)}
                              </p>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>

              {/* Detail panel */}
              <div>
                {!item ? (
                  <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <p className="text-sm text-white/40">
                      Select a deadline to see its source, correct fields, and link it.
                    </p>
                  </section>
                ) : (
                  <div className="space-y-6">
                    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[item.status]}`}
                        >
                          {item.status}
                        </span>
                        {item.dueReason?.unconfirmed && (
                          <span className="rounded-full border border-amber-400/30 bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                            Date needs confirmation
                          </span>
                        )}
                        {item.dueReason?.highRisk && (
                          <span className="rounded-full border border-rose-400/30 bg-rose-500/15 px-2.5 py-0.5 text-xs font-medium text-rose-300">
                            High risk
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-white/50">
                        {item.dueReason?.label ?? formatDateTime(item.dueAt)}
                      </p>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {item.dueReason?.unconfirmed && (
                          <ActionButton
                            busy={busy === "confirm"}
                            onClick={() => run("confirm", () => confirmAttention(item.id))}
                            label="Confirm date"
                            primary
                          />
                        )}
                        {item.status !== "completed" && item.status !== "dismissed" && (
                          <>
                            <ActionButton
                              busy={busy === "snooze"}
                              onClick={() =>
                                run("snooze", () => snoozeAttention(item.id, { preset: "1d_before" }))
                              }
                              label="Remind 1d before"
                            />
                            <ActionButton
                              busy={busy === "complete"}
                              onClick={() => run("complete", () => completeAttention(item.id))}
                              label="Mark done"
                            />
                            <ActionButton
                              busy={busy === "dismiss"}
                              onClick={() => run("dismiss", () => dismissAttention(item.id))}
                              label="Dismiss"
                            />
                          </>
                        )}
                        {(item.status === "completed" ||
                          item.status === "dismissed" ||
                          item.status === "snoozed") && (
                          <ActionButton
                            busy={busy === "reopen"}
                            onClick={() => run("reopen", () => reopenAttention(item.id))}
                            label="Reopen"
                            primary={!item.dueReason?.unconfirmed}
                          />
                        )}
                      </div>

                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        <Field label="Title">
                          <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
                          />
                        </Field>
                        <Field label="Kind">
                          <select
                            value={kind}
                            onChange={(e) => setKind(e.target.value as AttentionItemRecord["kind"])}
                            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
                          >
                            <option value="deadline">Deadline</option>
                            <option value="appointment">Appointment</option>
                            <option value="follow_up">Follow-up</option>
                            <option value="other">Reminder</option>
                          </select>
                        </Field>
                        <Field label="Date">
                          <input
                            type="date"
                            value={dueAt}
                            onChange={(e) => setDueAt(e.target.value)}
                            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
                          />
                        </Field>
                        <Field label="Date confidence">
                          <select
                            value={dateConfidence}
                            onChange={(e) =>
                              setDateConfidence(e.target.value as "certain" | "uncertain")
                            }
                            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
                          >
                            <option value="certain">certain</option>
                            <option value="uncertain">uncertain</option>
                          </select>
                        </Field>
                        <Field label="Timezone (if known)">
                          <input
                            value={timeZone}
                            onChange={(e) => setTimeZone(e.target.value)}
                            placeholder="e.g. America/New_York"
                            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
                          />
                        </Field>
                        <Field label="Notes">
                          <input
                            value={summary}
                            onChange={(e) => setSummary(e.target.value)}
                            placeholder="Optional context"
                            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
                          />
                        </Field>
                      </div>

                      <h3 className="mt-5 text-sm font-semibold text-white/70">Link to</h3>
                      <div className="mt-2 grid gap-4 md:grid-cols-2">
                        <Field label="Person">
                          <LinkSelect
                            value={personId}
                            onChange={setPersonId}
                            options={people.map((p) => ({ id: p.id, label: p.displayName }))}
                          />
                        </Field>
                        <Field label="Project">
                          <LinkSelect
                            value={projectId}
                            onChange={setProjectId}
                            options={projects.map((p) => ({ id: p.id, label: p.name }))}
                          />
                        </Field>
                        <Field label="Task">
                          <LinkSelect
                            value={taskId}
                            onChange={setTaskId}
                            options={tasks.map((t) => ({ id: t.id, label: t.title }))}
                          />
                        </Field>
                        <Field label="Organization">
                          <LinkSelect
                            value={organizationId}
                            onChange={setOrganizationId}
                            options={orgs.map((o) => ({ id: o.id, label: o.displayName }))}
                          />
                        </Field>
                        <Field label="Waiting item">
                          <LinkSelect
                            value={waitingItemId}
                            onChange={setWaitingItemId}
                            options={waitingItems.map((w) => ({
                              id: w.id,
                              label: `${w.ownerName}: ${w.deliverable.slice(0, 60)}`,
                            }))}
                          />
                        </Field>
                      </div>

                      <div className="mt-4">
                        <ActionButton
                          busy={busy === "save"}
                          onClick={save}
                          label="Save corrections"
                          primary
                          disabled={!dirty}
                        />
                      </div>
                    </section>

                    {/* Source */}
                    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                      <h2 className="text-lg font-semibold">Source</h2>
                      {item.evidenceText ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-white/70">
                          {item.evidenceText}
                        </p>
                      ) : (
                        <p className="mt-2 text-sm text-white/40">No source quote stored.</p>
                      )}
                      <div className="mt-3 flex items-center gap-3 text-xs text-white/40">
                        <span>
                          from {item.sourceEntityType.replace(/_/g, " ")}
                          {item.confidence != null
                            ? ` · extraction confidence ${Math.round(item.confidence * 100)}%`
                            : ""}
                        </span>
                        {sourceHref(item) && (
                          <a
                            href={sourceHref(item)!.href}
                            target={sourceHref(item)!.href.startsWith("http") ? "_blank" : undefined}
                            rel="noreferrer"
                            className="text-indigo-300 no-underline hover:text-indigo-200"
                          >
                            {sourceHref(item)!.label}
                          </a>
                        )}
                      </div>
                    </section>

                    {/* Timeline */}
                    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                      <h2 className="text-lg font-semibold">Timeline</h2>
                      {item.audit.length === 0 ? (
                        <p className="mt-2 text-sm text-white/40">No history yet.</p>
                      ) : (
                        <ul className="mt-3 space-y-2">
                          {item.audit.map((entry) => (
                            <li key={entry.id} className="flex items-start gap-3 text-sm">
                              <span className="mt-0.5 shrink-0 text-xs text-white/35">
                                {formatDateTime(entry.createdAt)}
                              </span>
                              <span className="text-white/75">
                                {AUDIT_LABEL[entry.action] ?? entry.action.replace(/_/g, " ")}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function LinkSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
    >
      <option value="">None</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/40">
        {label}
      </span>
      {children}
    </label>
  );
}

function ActionButton({
  busy,
  onClick,
  label,
  primary,
  disabled,
}: {
  busy: boolean;
  onClick: () => void;
  label: string;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${
        primary
          ? "bg-indigo-500/80 text-white hover:bg-indigo-500"
          : "border border-white/10 bg-white/[0.06] text-white/80 hover:bg-white/[0.12]"
      }`}
    >
      {busy ? "Working..." : label}
    </button>
  );
}
