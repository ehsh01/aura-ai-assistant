import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import { toast } from "@/hooks/use-toast";
import {
  completeWaitingItem,
  confirmWaitingCandidate,
  dismissWaitingItem,
  draftWaitingFollowUp,
  getWaitingItem,
  markWaitingFollowUpSent,
  patchWaitingItem,
  reopenWaitingItem,
  snoozeWaitingItem,
  type WaitingItemDetail,
  type WaitingItemRecord,
} from "@/lib/recall-api";

const STATUS_STYLE: Record<WaitingItemRecord["status"], string> = {
  candidate: "bg-violet-500/15 text-violet-300 border-violet-400/30",
  open: "bg-sky-500/15 text-sky-300 border-sky-400/30",
  snoozed: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  completed: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  dismissed: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

const AUDIT_LABEL: Record<string, string> = {
  waiting_item_created: "Tracked",
  waiting_candidate_created: "Suggested for review",
  waiting_candidate_confirmed: "Confirmed",
  waiting_item_updated: "Corrected",
  waiting_item_snoozed: "Snoozed",
  waiting_item_dismissed: "Dismissed",
  waiting_item_reopened: "Reopened",
  waiting_item_completed: "Completed",
  waiting_reply_completed: "Reply resolved it",
  waiting_reply_revised: "Reply revised the date",
  waiting_reply_still_waiting: "Reply: still waiting",
  waiting_reply_unclear: "Reply needs review",
  waiting_follow_up_drafted: "Follow-up drafted",
  waiting_follow_up_sent: "Follow-up sent",
};

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

function gmailComposeUrl(item: WaitingItemRecord, subject: string, body: string): string {
  const params = new URLSearchParams({ view: "cm", fs: "1", su: subject, body });
  const ownerEmail =
    typeof item.metadata?.ownerEmail === "string" ? item.metadata.ownerEmail : "";
  if (ownerEmail) params.set("to", ownerEmail);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function WaitingDetail() {
  const [, params] = useRoute("/waiting/:id");
  const id = params?.id;
  const [detail, setDetail] = useState<WaitingItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Editable fields (every extracted field is correctable).
  const [ownerName, setOwnerName] = useState("");
  const [ownerOrg, setOwnerOrg] = useState("");
  const [deliverable, setDeliverable] = useState("");
  const [promisedAt, setPromisedAt] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [dateConfidence, setDateConfidence] = useState<"certain" | "uncertain" | "none">(
    "none",
  );
  const [followUpAt, setFollowUpAt] = useState("");

  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);

  const applyItem = useCallback((item: WaitingItemRecord) => {
    setOwnerName(item.ownerName);
    setOwnerOrg(item.ownerOrg ?? "");
    setDeliverable(item.deliverable);
    setPromisedAt(toDateInput(item.promisedAt));
    setExpectedAt(toDateInput(item.expectedAt));
    setDateConfidence(item.dateConfidence);
    setFollowUpAt(toDateInput(item.followUpAt));
    const lastDraft = item.metadata?.lastDraft;
    if (
      lastDraft &&
      typeof lastDraft === "object" &&
      typeof (lastDraft as { subject?: unknown }).subject === "string"
    ) {
      setDraft({
        subject: (lastDraft as { subject: string }).subject,
        body: String((lastDraft as { body?: string }).body ?? ""),
      });
    }
  }, []);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const res = await getWaitingItem(id);
      setDetail(res);
      applyItem(res.item);
    } catch (err) {
      toast({
        title: "Could not load waiting item",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [id, applyItem]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const item = detail?.item ?? null;

  const dirty = useMemo(() => {
    if (!item) return false;
    return (
      ownerName !== item.ownerName ||
      ownerOrg !== (item.ownerOrg ?? "") ||
      deliverable !== item.deliverable ||
      promisedAt !== toDateInput(item.promisedAt) ||
      expectedAt !== toDateInput(item.expectedAt) ||
      dateConfidence !== item.dateConfidence ||
      followUpAt !== toDateInput(item.followUpAt)
    );
  }, [item, ownerName, ownerOrg, deliverable, promisedAt, expectedAt, dateConfidence, followUpAt]);

  const run = async (key: string, fn: () => Promise<WaitingItemRecord | null | void>) => {
    setBusy(key);
    try {
      const updated = await fn();
      if (updated) applyItem(updated);
      await reload();
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
      patchWaitingItem(id!, {
        ownerName,
        ownerOrg: ownerOrg || null,
        deliverable,
        promisedAt: promisedAt || null,
        expectedAt: expectedAt || null,
        dateConfidence,
        followUpAt: followUpAt || null,
      }),
    );

  const generateDraft = () =>
    run("draft", async () => {
      const res = await draftWaitingFollowUp(id!);
      setDraft({ subject: res.draft.subject, body: res.draft.body });
      return res.item;
    });

  const copyDraft = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      toast({ title: "Copied", description: "Follow-up copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Select the text and copy manually." });
    }
  };

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#0a0a0f] p-4 md:p-8 text-white">
        <div className="mx-auto max-w-4xl">
          <Link href="/today" className="text-sm text-indigo-300 no-underline">
            Back to Today
          </Link>

          {loading || !item ? (
            <div className="mt-8 text-white/40">Loading waiting item...</div>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold leading-tight">{item.deliverable}</h1>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[item.status]}`}
                >
                  {item.status}
                </span>
                {item.needsReview && (
                  <span className="rounded-full border border-rose-400/30 bg-rose-500/15 px-2.5 py-0.5 text-xs font-medium text-rose-300">
                    Reply needs review
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-white/50">
                {item.ownerName}
                {item.ownerOrg ? ` · ${item.ownerOrg}` : ""} · promised{" "}
                {formatDate(item.promisedAt)} · next follow-up {formatDate(item.followUpAt)}
              </p>

              {item.status === "candidate" && (
                <div className="mt-4 rounded-2xl border border-violet-400/30 bg-violet-500/10 px-4 py-3">
                  <p className="text-sm font-medium text-violet-200">Aura isn't sure yet</p>
                  <p className="mt-0.5 text-sm text-white/60">
                    {item.candidateReason ??
                      "Possible follow-up — confirm to start tracking it."}
                  </p>
                </div>
              )}

              {item.suggestedResolution && item.status === "open" && (
                <div className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3">
                  <p className="text-sm font-medium text-emerald-200">
                    A reply suggests this is resolved
                  </p>
                  <p className="mt-0.5 text-sm text-white/60">
                    {item.suggestedResolution.reason ||
                      "The latest reply looks like it closes this out."}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <ActionButton
                      busy={busy === "resolve"}
                      onClick={() => run("resolve", () => completeWaitingItem(id!))}
                      label="Mark resolved"
                      primary
                    />
                    <ActionButton
                      busy={busy === "keep-waiting"}
                      onClick={() =>
                        run("keep-waiting", () => markWaitingFollowUpSent(id!, { days: 3 }))
                      }
                      label="Keep waiting"
                    />
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="mt-4 flex flex-wrap gap-2">
                {item.status === "candidate" && (
                  <>
                    <ActionButton
                      busy={busy === "confirm"}
                      onClick={() => run("confirm", () => confirmWaitingCandidate(id!))}
                      label="Confirm — track it"
                      primary
                    />
                    <ActionButton
                      busy={busy === "snooze3"}
                      onClick={() => run("snooze3", () => snoozeWaitingItem(id!, { preset: "3d" }))}
                      label="Snooze 3d"
                    />
                    <ActionButton
                      busy={busy === "dismiss"}
                      onClick={() => run("dismiss", () => dismissWaitingItem(id!))}
                      label="Dismiss"
                    />
                  </>
                )}
                {(item.status === "open" || item.status === "snoozed") && (
                  <>
                    <ActionButton
                      busy={busy === "draft"}
                      onClick={generateDraft}
                      label={draft ? "Regenerate follow-up" : "Draft follow-up"}
                      primary
                    />
                    <ActionButton
                      busy={busy === "snooze1"}
                      onClick={() => run("snooze1", () => snoozeWaitingItem(id!, { preset: "1d" }))}
                      label="Snooze 1d"
                    />
                    <ActionButton
                      busy={busy === "snooze3"}
                      onClick={() => run("snooze3", () => snoozeWaitingItem(id!, { preset: "3d" }))}
                      label="Snooze 3d"
                    />
                    <ActionButton
                      busy={busy === "complete"}
                      onClick={() => run("complete", () => completeWaitingItem(id!))}
                      label="Mark complete"
                    />
                    <ActionButton
                      busy={busy === "dismiss"}
                      onClick={() => run("dismiss", () => dismissWaitingItem(id!))}
                      label="Dismiss"
                    />
                  </>
                )}
                {(item.status === "completed" || item.status === "dismissed") && (
                  <ActionButton
                    busy={busy === "reopen"}
                    onClick={() => run("reopen", () => reopenWaitingItem(id!))}
                    label="Reopen"
                    primary
                  />
                )}
              </div>

              {/* Correctable fields */}
              <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h2 className="text-lg font-semibold">Commitment</h2>
                <p className="mt-1 text-sm text-white/45">
                  Every extracted field can be corrected. Uncertain dates stay labeled
                  uncertain — no invented deadlines.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Field label="Who owes it">
                    <input
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
                    />
                  </Field>
                  <Field label="Organization">
                    <input
                      value={ownerOrg}
                      onChange={(e) => setOwnerOrg(e.target.value)}
                      placeholder="Optional"
                      className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
                    />
                  </Field>
                  <Field label="Promised on">
                    <input
                      type="date"
                      value={promisedAt}
                      onChange={(e) => setPromisedAt(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
                    />
                  </Field>
                  <Field label={`Expected ${dateConfidence === "certain" ? "(certain)" : dateConfidence === "uncertain" ? "(uncertain)" : "(no date stated)"}`}>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={expectedAt}
                        onChange={(e) => setExpectedAt(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
                      />
                      <select
                        value={dateConfidence}
                        onChange={(e) =>
                          setDateConfidence(e.target.value as "certain" | "uncertain" | "none")
                        }
                        className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm outline-none focus:border-indigo-400/60"
                      >
                        <option value="certain">certain</option>
                        <option value="uncertain">uncertain</option>
                        <option value="none">none</option>
                      </select>
                    </div>
                  </Field>
                  <Field label="Next follow-up" >
                    <input
                      type="date"
                      value={followUpAt}
                      onChange={(e) => setFollowUpAt(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
                    />
                  </Field>
                </div>
                <div className="mt-4">
                  <Field label="Promised deliverable">
                    <textarea
                      value={deliverable}
                      onChange={(e) => setDeliverable(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
                    />
                  </Field>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <ActionButton busy={busy === "save"} onClick={save} label="Save corrections" primary disabled={!dirty} />
                  {item.lastOutcome && (
                    <span className="text-xs text-white/40">
                      Last reply outcome: {item.lastOutcome.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
              </section>

              {/* Follow-up draft */}
              {draft && (
                <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <h2 className="text-lg font-semibold">Follow-up draft</h2>
                  <p className="mt-1 text-sm text-white/45">
                    Grounded in the original thread — review before sending.
                  </p>
                  <input
                    value={draft.subject}
                    onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                    className="mt-3 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
                  />
                  <textarea
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    rows={6}
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400/60"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ActionButton busy={false} onClick={copyDraft} label="Copy" />
                    <a
                      href={gmailComposeUrl(item, draft.subject, draft.body)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/80 no-underline hover:bg-white/[0.12]"
                    >
                      Open in Gmail
                    </a>
                    <ActionButton
                      busy={busy === "sent"}
                      onClick={() => run("sent", () => markWaitingFollowUpSent(id!))}
                      label="Mark sent · follow up in 3d"
                      primary
                    />
                  </div>
                </section>
              )}

              {/* Timeline */}
              <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h2 className="text-lg font-semibold">Timeline</h2>
                {detail!.audit.length === 0 ? (
                  <p className="mt-2 text-sm text-white/40">No history yet.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {detail!.audit.map((entry) => {
                      const reason =
                        typeof entry.metadata?.reason === "string"
                          ? entry.metadata.reason
                          : null;
                      return (
                        <li key={entry.id} className="flex items-start gap-3 text-sm">
                          <span className="mt-0.5 shrink-0 text-xs text-white/35">
                            {formatDateTime(entry.createdAt)}
                          </span>
                          <span className="text-white/75">
                            {AUDIT_LABEL[entry.action] ?? entry.action.replace(/_/g, " ")}
                            {reason ? (
                              <span className="block text-xs text-white/40">{reason}</span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {/* Evidence */}
              <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h2 className="text-lg font-semibold">Source evidence</h2>
                {detail!.evidence.length === 0 ? (
                  <p className="mt-2 text-sm text-white/40">No evidence linked yet.</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {detail!.evidence.map((ev) => {
                      const sourceUrl =
                        typeof ev.evidenceMetadata?.sourceUrl === "string"
                          ? ev.evidenceMetadata.sourceUrl
                          : null;
                      return (
                        <li
                          key={ev.id}
                          className="rounded-lg border border-white/5 bg-black/30 p-3 text-sm"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs uppercase tracking-wide text-white/35">
                              {ev.claimType.replace(/_/g, " ")}
                            </span>
                            {sourceUrl && (
                              <a
                                href={sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 text-xs text-indigo-300 no-underline hover:text-indigo-200"
                              >
                                Open in Gmail
                              </a>
                            )}
                          </div>
                          {ev.evidenceText && (
                            <p className="mt-1 whitespace-pre-wrap text-white/70">
                              {ev.evidenceText}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </AppLayout>
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
