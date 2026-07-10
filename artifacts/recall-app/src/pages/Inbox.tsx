import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { acceptCapture, listCaptureInbox, updateCapture } from "@workspace/api-client-react";
import { AppLayout } from "@/components/AppLayout";
import { EvidenceDrawer } from "@/components/EvidenceDrawer";
import { useRecallData } from "@/context/RecallDataContext";
import { toast } from "@/hooks/use-toast";
import type { RecallCaptureItem } from "@/lib/recall-context";
import { listPeople, type PersonRecord } from "@/lib/recall-api";
import { notesPath, memoryPath, readSearchParam } from "@/lib/recall-nav";
import { LIFE_MEMORY_DOMAINS, type LifeMemoryDomain } from "@/lib/recall-api";

const priorityClass: Record<RecallCaptureItem["suggestedPriority"], string> = {
  low: "text-blue-300 bg-blue-500/10",
  medium: "text-white/60 bg-white/5",
  high: "text-orange-300 bg-orange-500/10",
  urgent: "text-red-300 bg-red-500/10",
};

const DOMAIN_LABELS: Record<LifeMemoryDomain, string> = {
  family: "Family",
  vehicles: "Vehicles",
  home: "Home",
  health: "Health",
  work: "Work",
  finance: "Finance",
  people: "People",
  preferences: "Preferences",
  procedures: "Procedures",
  other: "Other",
};

export function Inbox() {
  const { reloadNotes, reloadTasks } = useRecallData();
  const [, navigate] = useLocation();
  const [items, setItems] = useState<RecallCaptureItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [evidenceTarget, setEvidenceTarget] = useState<RecallCaptureItem | null>(null);
  /** Capture ids where the user cleared a wrong suggested person. */
  const [clearedPerson, setClearedPerson] = useState<Record<string, true>>({});
  /** Manual person override per capture (typed or picked). */
  const [personOverride, setPersonOverride] = useState<Record<string, string>>({});
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  /** Optional domain override when saving to Memory. */
  const [memoryDomain, setMemoryDomain] = useState<Record<string, LifeMemoryDomain | "">>({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await listCaptureInbox();
      setItems(res.items as RecallCaptureItem[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void listPeople()
      .then((res) => setPeople(res.people))
      .catch(() => {});
  }, []);

  // Deep link: /inbox?capture=<id> — scroll the matching card into view.
  useEffect(() => {
    if (loading) return;
    const captureId = readSearchParam("capture");
    if (!captureId) return;
    const el = document.getElementById(`capture-${captureId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-indigo-400/60");
      window.setTimeout(() => {
        el.classList.remove("ring-2", "ring-indigo-400/60");
      }, 2500);
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("capture");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [loading, items]);

  const personFor = (item: RecallCaptureItem): string | null => {
    const override = personOverride[item.id]?.trim();
    if (override) return override;
    if (clearedPerson[item.id]) return null;
    return item.suggestedPersonName ?? null;
  };

  const peopleSuggestions = useMemo(() => {
    if (!pickerFor) return [];
    const q = (personOverride[pickerFor] ?? "").trim().toLowerCase();
    if (!q) return people.slice(0, 8);
    return people
      .filter((p) => p.displayName.toLowerCase().includes(q))
      .slice(0, 8);
  }, [pickerFor, personOverride, people]);

  const accept = async (
    item: RecallCaptureItem,
    opts?: { saveAsMemory?: boolean },
  ) => {
    try {
      const personName = personFor(item);
      const cleared = Boolean(clearedPerson[item.id]);
      const hasOverride = Boolean(personOverride[item.id]?.trim());
      const domain = memoryDomain[item.id];
      const body: Record<string, unknown> = personName
        ? { personName }
        : cleared || hasOverride
          ? { skipPerson: true, personName: null }
          : {};
      if (opts?.saveAsMemory) {
        body.saveAsMemory = true;
        if (domain) body.memoryDomain = domain;
      }
      const res = await acceptCapture(item.id, body as Parameters<typeof acceptCapture>[1]);
      await Promise.all([load(), reloadNotes(), reloadTasks()]);
      setPersonOverride((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setClearedPerson((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setMemoryDomain((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setPickerFor(null);
      const linked =
        res.personName != null && res.personName !== ""
          ? ` Linked to ${res.personName}.`
          : "";
      const memoryId =
        res && typeof res === "object" && "memory" in res
          ? (res as { memory?: { id?: string; title?: string; domain?: string } }).memory
          : undefined;
      if (memoryId?.id) {
        toast({
          title: "Saved to Memory",
          description: `${memoryId.title ?? "Fact"}${memoryId.domain ? ` · ${memoryId.domain}` : ""}.${linked}`,
        });
        navigate(memoryPath({ memoryId: memoryId.id }));
        return;
      }
      if (res.task?.id) {
        toast({
          title: "Task created",
          description: `${res.task.title}.${linked} Opening it now.`,
        });
        navigate(`/tasks?task=${encodeURIComponent(res.task.id)}`);
        return;
      }
      if (res.note?.id) {
        toast({
          title: "Note created",
          description: `${res.note.title}.${linked} Opening it now.`,
        });
        navigate(notesPath({ noteId: res.note.id }));
        return;
      }
      toast({
        title: "Capture accepted",
        description: `Moved into notes or tasks.${linked} Logged in Activity.`,
      });
    } catch {
      toast({ title: "Could not accept capture", variant: "destructive" });
    }
  };

  const dismiss = async (item: RecallCaptureItem) => {
    try {
      await updateCapture(item.id, { status: "dismissed" });
      await load();
      toast({ title: "Dismissed", description: "Logged in Activity." });
    } catch {
      toast({ title: "Could not dismiss capture", variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#0a0a0f] p-4 md:p-8 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">Capture</p>
              <h1 className="mt-2 text-3xl font-semibold">AI Inbox</h1>
              <p className="mt-2 text-white/50">
                Review raw captures before Recall turns them into notes, tasks, reminders, or references.
              </p>
            </div>
            <Link
              href="/activity"
              className="mt-1 rounded-xl border border-white/10 px-3 py-2 text-xs text-indigo-200 no-underline hover:bg-white/5"
            >
              View Activity
            </Link>
          </div>

          <div className="mt-8 space-y-4">
            {loading && <div className="text-white/40">Loading captures...</div>}
            {!loading && items.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-white/45">
                No pending captures. Use + Capture to send something here.
              </div>
            )}
            {items.map((item) => {
              const person = personFor(item);
              const picking = pickerFor === item.id;
              return (
              <article
                id={`capture-${item.id}`}
                key={item.id}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition ring-offset-2 ring-offset-[#0a0a0f]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">{item.cleanedTitle}</h2>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-indigo-500/10 px-2 py-1 text-indigo-200">
                        {item.suggestedType.replace("_", " ")}
                      </span>
                      <span className={`rounded-full px-2 py-1 ${priorityClass[item.suggestedPriority]}`}>
                        {item.suggestedPriority}
                      </span>
                      {item.suggestedDueDate && (
                        <span className="rounded-full bg-white/5 px-2 py-1 text-white/55">
                          due {item.suggestedDueDate}
                        </span>
                      )}
                      {person && !picking && (
                        <button
                          type="button"
                          onClick={() => {
                            setClearedPerson((prev) => ({ ...prev, [item.id]: true }));
                            setPersonOverride((prev) => {
                              const next = { ...prev };
                              delete next[item.id];
                              return next;
                            });
                          }}
                          title="Clear person link"
                          className="rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-1 text-sky-200 hover:border-sky-400/40 hover:bg-sky-500/20"
                        >
                          → {person} ×
                        </button>
                      )}
                      {!person && !picking && (
                        <button
                          type="button"
                          onClick={() => setPickerFor(item.id)}
                          className="rounded-full border border-white/15 px-2 py-1 text-white/55 hover:border-sky-400/40 hover:text-sky-200"
                        >
                          + Link person
                        </button>
                      )}
                      {person && !picking && (
                        <button
                          type="button"
                          onClick={() => {
                            setPersonOverride((prev) => ({
                              ...prev,
                              [item.id]: person,
                            }));
                            setPickerFor(item.id);
                          }}
                          className="rounded-full border border-white/10 px-2 py-1 text-white/45 hover:text-white/70"
                        >
                          Change
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEvidenceTarget(item)}
                      className="rounded-xl border border-white/10 px-3 py-2 text-sm text-indigo-200 hover:bg-white/5"
                    >
                      Show Evidence
                    </button>
                    <button
                      type="button"
                      onClick={() => void dismiss(item)}
                      className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white/55 hover:text-white"
                    >
                      Dismiss
                    </button>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={memoryDomain[item.id] ?? ""}
                        onChange={(e) =>
                          setMemoryDomain((prev) => ({
                            ...prev,
                            [item.id]: e.target.value as LifeMemoryDomain | "",
                          }))
                        }
                        className="rounded-xl border border-white/10 bg-black/30 px-2 py-2 text-xs text-white/70"
                        title="Memory domain (optional)"
                      >
                        <option value="">Auto domain</option>
                        {LIFE_MEMORY_DOMAINS.map((d) => (
                          <option key={d} value={d}>
                            {DOMAIN_LABELS[d]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void accept(item, { saveAsMemory: true })}
                        className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20"
                      >
                        Save to Memory
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void accept(item)}
                      className="rounded-xl bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400"
                    >
                      {person ? `Accept · ${person}` : "Accept"}
                    </button>
                  </div>
                </div>
                {picking && (
                  <div className="mt-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
                    <label className="block text-xs text-sky-200/80">
                      Person to link on accept
                      <input
                        autoFocus
                        value={personOverride[item.id] ?? ""}
                        onChange={(e) =>
                          setPersonOverride((prev) => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const name = (personOverride[item.id] ?? "").trim();
                            if (name) {
                              setClearedPerson((prev) => {
                                const next = { ...prev };
                                delete next[item.id];
                                return next;
                              });
                            }
                            setPickerFor(null);
                          }
                          if (e.key === "Escape") setPickerFor(null);
                        }}
                        placeholder="Type a name or pick below"
                        className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50"
                      />
                    </label>
                    {peopleSuggestions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {peopleSuggestions.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setPersonOverride((prev) => ({
                                ...prev,
                                [item.id]: p.displayName,
                              }));
                              setClearedPerson((prev) => {
                                const next = { ...prev };
                                delete next[item.id];
                                return next;
                              });
                              setPickerFor(null);
                            }}
                            className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/70 hover:border-sky-400/40 hover:text-sky-100"
                          >
                            {p.displayName}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const name = (personOverride[item.id] ?? "").trim();
                          if (name) {
                            setClearedPerson((prev) => {
                              const next = { ...prev };
                              delete next[item.id];
                              return next;
                            });
                          } else {
                            setClearedPerson((prev) => ({ ...prev, [item.id]: true }));
                            setPersonOverride((prev) => {
                              const next = { ...prev };
                              delete next[item.id];
                              return next;
                            });
                          }
                          setPickerFor(null);
                        }}
                        className="rounded-lg bg-sky-500/20 px-2.5 py-1 text-xs text-sky-100 hover:bg-sky-500/30"
                      >
                        Done
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPersonOverride((prev) => {
                            const next = { ...prev };
                            delete next[item.id];
                            return next;
                          });
                          setClearedPerson((prev) => ({ ...prev, [item.id]: true }));
                          setPickerFor(null);
                        }}
                        className="rounded-lg px-2.5 py-1 text-xs text-white/45 hover:text-white/70"
                      >
                        No person
                      </button>
                    </div>
                  </div>
                )}
                {person && !picking && (
                  <p className="mt-3 text-xs text-sky-200/70">
                    Will link to <span className="font-medium text-sky-100">{person}</span> on
                    accept. Tap the chip to clear if wrong.
                  </p>
                )}
                <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{item.rawText}</p>
                {item.suggestedActions.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.suggestedActions.map((action) => (
                      <span key={action} className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/45">
                        {action}
                      </span>
                    ))}
                  </div>
                )}
              </article>
              );
            })}
          </div>
        </div>
      </div>
      <EvidenceDrawer
        open={evidenceTarget != null}
        onClose={() => setEvidenceTarget(null)}
        entityType="capture_item"
        entityId={evidenceTarget?.id ?? ""}
        title={evidenceTarget?.cleanedTitle}
      />
    </AppLayout>
  );
}
