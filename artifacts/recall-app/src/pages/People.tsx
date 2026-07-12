import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import { PersonContextCard } from "@/components/PersonContextCard";
import {
  createPerson,
  createWaitingFollowUp,
  getPersonRelated,
  listPeople,
  listWaitingOn,
  updatePerson,
  type PersonRecord,
  type WaitingOnRecord,
} from "@/lib/recall-api";
import {
  peoplePath,
  readSearchParam,
} from "@/lib/recall-nav";
import { invalidatePeopleCache } from "@/components/PersonTagLink";
import { toast } from "@/hooks/use-toast";
import { Pencil } from "lucide-react";

type OpenTask = { id: string; title: string; time: string | null };
type TaggedNote = { id: string; title: string; preview: string };
type TaggedKnowledge = { id: string; title: string; itemType: string };
type LinkedMemory = { id: string; title: string; domain: string };

function waitingForPerson(
  waiting: WaitingOnRecord[],
  person: PersonRecord,
): WaitingOnRecord[] {
  const lower = person.displayName.toLowerCase();
  return waiting.filter(
    (w) =>
      w.personId === person.id ||
      w.person.toLowerCase() === lower ||
      w.person.toLowerCase().includes(lower) ||
      lower.includes(w.person.toLowerCase()),
  );
}

export function People() {
  const [location, navigate] = useLocation();
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [waiting, setWaiting] = useState<WaitingOnRecord[]>([]);
  const [openByPerson, setOpenByPerson] = useState<Record<string, OpenTask[]>>({});
  const [notesByPerson, setNotesByPerson] = useState<Record<string, TaggedNote[]>>({});
  const [knowledgeByPerson, setKnowledgeByPerson] = useState<
    Record<string, TaggedKnowledge[]>
  >({});
  const [memoriesByPerson, setMemoriesByPerson] = useState<
    Record<string, LinkedMemory[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [query, setQuery] = useState("");
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    displayName: "",
    email: "",
    phone: "",
    organization: "",
    role: "",
    notes: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [relatedLoadingId, setRelatedLoadingId] = useState<string | null>(null);
  const personRefs = useRef<Record<string, HTMLElement | null>>({});
  const relatedLoaded = useRef<Record<string, true>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [peopleRes, waitingRes] = await Promise.all([listPeople(), listWaitingOn()]);
      setPeople(peopleRes.people);
      setWaiting(waitingRes.items);
      relatedLoaded.current = {};
      setOpenByPerson({});
      setNotesByPerson({});
      setKnowledgeByPerson({});
      setMemoriesByPerson({});
    } finally {
      setLoading(false);
    }
  };

  const loadRelated = async (personId: string) => {
    if (relatedLoaded.current[personId]) return;
    setRelatedLoadingId(personId);
    try {
      const r = await getPersonRelated(personId);
      relatedLoaded.current[personId] = true;
      setOpenByPerson((prev) => ({ ...prev, [personId]: r.openTasks }));
      setNotesByPerson((prev) => ({
        ...prev,
        [personId]: r.taggedNotes ?? [],
      }));
      setKnowledgeByPerson((prev) => ({
        ...prev,
        [personId]: r.taggedKnowledge ?? [],
      }));
      setMemoriesByPerson((prev) => ({
        ...prev,
        [personId]: r.linkedMemories ?? [],
      }));
    } catch {
      relatedLoaded.current[personId] = true;
      setOpenByPerson((prev) => ({ ...prev, [personId]: [] }));
      setNotesByPerson((prev) => ({ ...prev, [personId]: [] }));
      setKnowledgeByPerson((prev) => ({ ...prev, [personId]: [] }));
      setMemoriesByPerson((prev) => ({ ...prev, [personId]: [] }));
    } finally {
      setRelatedLoadingId((cur) => (cur === personId ? null : cur));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Lazy-load related tasks/notes when a person is expanded.
  useEffect(() => {
    if (!selectedId) return;
    void loadRelated(selectedId);
  }, [selectedId]);

  // Deep-link from Today / elsewhere: /people?person=<id>
  useEffect(() => {
    const personId = readSearchParam("person");
    if (!personId || people.length === 0) return;
    if (!people.some((p) => p.id === personId)) return;

    setSelectedId(personId);
    setHighlightedId(personId);
    requestAnimationFrame(() => {
      personRefs.current[personId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setHighlightedId(null), 3500);
    return () => window.clearTimeout(timer);
  }, [location, people]);

  const addPerson = async () => {
    if (!name.trim()) return;
    try {
      const created = await createPerson({
        displayName: name.trim(),
        email: email.trim() || null,
      });
      setName("");
      setEmail("");
      invalidatePeopleCache();
      await load();
      setSelectedId(created.id);
      navigate(peoplePath({ personId: created.id }));
      toast({ title: "Person added" });
    } catch {
      toast({ title: "Could not add person", variant: "destructive" });
    }
  };

  const followUp = async (item: WaitingOnRecord) => {
    if (creatingId) return;
    setCreatingId(item.id);
    try {
      const res = await createWaitingFollowUp(item.id);
      toast({
        title: "Follow-up task created",
        description: res.task.title,
      });
      navigate(`/tasks?task=${encodeURIComponent(res.task.id)}`);
    } catch (err) {
      toast({
        title: "Could not create follow-up",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setCreatingId(null);
    }
  };

  const selectPerson = (personId: string) => {
    setEditing(false);
    setSelectedId((prev) => {
      const next = prev === personId ? null : personId;
      navigate(next ? peoplePath({ personId: next }) : peoplePath(), { replace: true });
      return next;
    });
  };

  const startEdit = (person: PersonRecord) => {
    setEditForm({
      displayName: person.displayName,
      email: person.email ?? "",
      phone: person.phone ?? "",
      organization: person.organization ?? "",
      role: person.role ?? "",
      notes: person.notes ?? "",
    });
    setEditing(true);
  };

  const saveEdit = async (personId: string) => {
    if (!editForm.displayName.trim() || savingEdit) return;
    setSavingEdit(true);
    try {
      await updatePerson(personId, {
        displayName: editForm.displayName.trim(),
        email: editForm.email.trim() || null,
        phone: editForm.phone.trim() || null,
        organization: editForm.organization.trim() || null,
        role: editForm.role.trim() || null,
        notes: editForm.notes.trim() || null,
      });
      setEditing(false);
      invalidatePeopleCache();
      await load();
      toast({ title: "Contact updated" });
    } catch {
      toast({ title: "Could not update contact", variant: "destructive" });
    } finally {
      setSavingEdit(false);
    }
  };

  const selected = people.find((p) => p.id === selectedId) ?? null;
  const q = query.trim().toLowerCase();
  const filteredPeople = q
    ? people.filter((p) => {
        const hay = [
          p.displayName,
          p.email,
          p.organization,
          p.role,
          p.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
    : people;

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#0a0a0f] p-4 md:p-8 text-white">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">Network</p>
          <h1 className="mt-2 text-3xl font-semibold">People</h1>
          <p className="mt-2 text-white/50">
            Contacts plus what you&apos;re waiting on from them — tap a person to see linked tasks.
          </p>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people…"
            className="mt-5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none focus:border-indigo-500/40"
          />

          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Waiting on</h2>
              <Link href="/ask" className="text-xs text-indigo-300 no-underline hover:underline">
                Ask about follow-ups
              </Link>
            </div>
            {loading && <p className="text-white/40">Loading…</p>}
            {!loading && waiting.length === 0 && (
              <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">
                Nothing looks like it&apos;s waiting on someone right now. Capture a note like
                “waiting on quote from Mike” and it will show up here.
              </p>
            )}
            <div className="space-y-2">
              {waiting.map((w) => (
                <article
                  key={w.id}
                  className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {w.personId ? (
                        <button
                          type="button"
                          onClick={() => selectPerson(w.personId!)}
                          className="text-left text-xs uppercase tracking-wider text-amber-200/70 hover:text-amber-100"
                        >
                          {w.person}
                          {w.days > 0 ? ` · ${w.days}d` : ""}
                          {" · "}
                          {w.sourceType}
                        </button>
                      ) : (
                        <p className="text-xs uppercase tracking-wider text-amber-200/70">
                          {w.person}
                          {w.days > 0 ? ` · ${w.days}d` : ""}
                          {" · "}
                          {w.sourceType}
                        </p>
                      )}
                      <Link href={w.href} className="mt-1 block no-underline">
                        <h3 className="font-semibold text-white">{w.item}</h3>
                        <p className="mt-1 line-clamp-2 text-sm text-white/50">{w.evidenceText}</p>
                      </Link>
                    </div>
                    <button
                      type="button"
                      onClick={() => void followUp(w)}
                      disabled={creatingId === w.id}
                      className="flex-shrink-0 rounded-xl bg-indigo-500 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
                    >
                      {creatingId === w.id ? "Creating…" : "Follow up"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className="mt-10 flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email (optional)"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void addPerson()}
              className="rounded-xl bg-indigo-500/20 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/30"
            >
              Add person
            </button>
          </div>

          <div className="mt-6 space-y-3">
            {!loading && people.length === 0 && (
              <p className="text-white/45">
                No people yet. Accept an Inbox item that mentions someone, or add a contact above.
              </p>
            )}
            {!loading && people.length > 0 && filteredPeople.length === 0 && (
              <p className="text-white/45">No people match “{query.trim()}”.</p>
            )}
            {filteredPeople.map((person) => {
              const openTasks = openByPerson[person.id] ?? [];
              const taggedNotes = notesByPerson[person.id] ?? [];
              const taggedKnowledge = knowledgeByPerson[person.id] ?? [];
              const linkedMemories = memoriesByPerson[person.id] ?? [];
              const personWaiting = waitingForPerson(waiting, person);
              const isSelected = selected?.id === person.id;
              const isHighlighted = highlightedId === person.id;
              return (
                <article
                  key={person.id}
                  ref={(el) => {
                    personRefs.current[person.id] = el;
                  }}
                  className={`rounded-2xl border p-4 transition-colors ${
                    isHighlighted
                      ? "border-sky-500/50 bg-sky-500/10 ring-1 ring-sky-500/30"
                      : isSelected
                        ? "border-indigo-500/40 bg-indigo-500/10"
                        : "border-white/10 bg-white/[0.04]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectPerson(person.id)}
                    className="w-full text-left"
                  >
                    <h2 className="text-lg font-semibold">{person.displayName}</h2>
                    <div className="mt-1 space-y-0.5 text-sm text-white/50">
                      {person.email && <p>{person.email}</p>}
                      {person.organization && <p>{person.organization}</p>}
                      {person.role && <p>{person.role}</p>}
                      {!isSelected && (
                        <p className="pt-1 text-xs text-white/35">
                          {personWaiting.length > 0
                            ? `${personWaiting.length} waiting · tap to expand`
                            : "Tap to expand"}
                        </p>
                      )}
                    </div>
                  </button>

                  {isSelected && (
                    <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
                      {editing && (
                        <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                          {(
                            [
                              ["displayName", "Name"],
                              ["email", "Email"],
                              ["phone", "Phone"],
                              ["organization", "Organization"],
                              ["role", "Role"],
                            ] as const
                          ).map(([key, label]) => (
                            <label key={key} className="block">
                              <span className="text-[11px] uppercase tracking-wider text-white/35">
                                {label}
                              </span>
                              <input
                                value={editForm[key]}
                                onChange={(e) =>
                                  setEditForm((prev) => ({ ...prev, [key]: e.target.value }))
                                }
                                className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500/40"
                              />
                            </label>
                          ))}
                          <label className="block">
                            <span className="text-[11px] uppercase tracking-wider text-white/35">
                              Notes
                            </span>
                            <textarea
                              value={editForm.notes}
                              onChange={(e) =>
                                setEditForm((prev) => ({ ...prev, notes: e.target.value }))
                              }
                              rows={2}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500/40"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => void saveEdit(person.id)}
                            disabled={savingEdit || !editForm.displayName.trim()}
                            className="rounded-xl bg-indigo-500 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
                          >
                            {savingEdit ? "Saving…" : "Save contact"}
                          </button>
                        </div>
                      )}

                      <PersonContextCard
                        displayName={person.displayName}
                        personId={person.id}
                        loading={relatedLoadingId === person.id}
                        openTasks={openTasks}
                        taggedNotes={taggedNotes}
                        taggedKnowledge={taggedKnowledge}
                        linkedMemories={linkedMemories}
                        waiting={personWaiting}
                        onFollowUp={(w) => void followUp(w)}
                        creatingFollowUpId={creatingId}
                        actions={
                          <button
                            type="button"
                            onClick={() => (editing ? setEditing(false) : startEdit(person))}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5 hover:text-white/80"
                          >
                            <Pencil size={12} />
                            {editing ? "Cancel" : "Edit"}
                          </button>
                        }
                      />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
