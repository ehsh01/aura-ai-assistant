import { useState } from "react";
import { Link } from "wouter";
import { BookmarkPlus, CalendarClock, HelpCircle, Layers } from "lucide-react";
import {
  createMemory,
  setWorkingContext,
  type HomeBriefingResponse,
  type PersonRecord,
} from "@/lib/recall-api";
import type { RecallProject } from "@/lib/recall-context";
import { toast } from "@/hooks/use-toast";

export function WorkingContextChip({
  context,
  people,
  projects,
  onChanged,
}: {
  context: HomeBriefingResponse["workingContext"];
  people: PersonRecord[];
  projects: RecallProject[];
  onChanged: () => void;
}) {
  const [personId, setPersonId] = useState(context?.personId ?? "");
  const [projectId, setProjectId] = useState(context?.projectId ?? "");
  const [saving, setSaving] = useState(false);

  const save = async (next: { personId?: string | null; projectId?: string | null }) => {
    setSaving(true);
    try {
      await setWorkingContext(next);
      onChanged();
    } catch (err) {
      toast({
        title: "Could not update context",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/45">
        <Layers className="h-3.5 w-3.5 text-indigo-300" />
        Working on
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <select
          value={personId}
          disabled={saving}
          onChange={(e) => {
            const value = e.target.value;
            setPersonId(value);
            void save({ personId: value || null });
          }}
          className="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white"
        >
          <option value="">Any person</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
        <select
          value={projectId}
          disabled={saving}
          onChange={(e) => {
            const value = e.target.value;
            setProjectId(value);
            void save({ projectId: value || null });
          }}
          className="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white"
        >
          <option value="">Any project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-xs text-white/35">
        Captures and voice notes use this when you don’t name someone.
      </p>
    </section>
  );
}

export function WhatChangedSection({
  items,
}: {
  items: NonNullable<HomeBriefingResponse["whatChanged"]>;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wider text-white/50">
        Since you last looked
      </h2>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={item.href} className="block rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 no-underline">
              <p className="text-sm text-zinc-100">{item.title}</p>
              <p className="text-xs text-white/40">{item.detail}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MeetingPrepSection({
  items,
}: {
  items: NonNullable<HomeBriefingResponse["meetingPrep"]>;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold uppercase tracking-wider text-white/50">
        <CalendarClock className="h-4 w-4 text-sky-300" />
        Meeting prep
      </h2>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.eventId}>
            <Link href={item.href} className="block rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 no-underline">
              <p className="text-sm text-zinc-100">
                {item.startLabel ? `${item.startLabel} · ` : ""}
                {item.title}
              </p>
              <p className="text-xs text-white/40">
                {item.recentContext ??
                  (item.waitingCount > 0
                    ? `${item.waitingCount} open follow-up${item.waitingCount === 1 ? "" : "s"}`
                    : "On your calendar today")}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OpenQuestionsStrip({
  items,
}: {
  items: NonNullable<HomeBriefingResponse["openQuestions"]>;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold uppercase tracking-wider text-white/50">
        <HelpCircle className="h-4 w-4 text-amber-300" />
        Quick questions
      </h2>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-100 no-underline"
          >
            {item.title}
          </Link>
        ))}
      </div>
    </section>
  );
}

export function TeachCard({
  personId,
  projectId,
  onSaved,
}: {
  personId?: string | null;
  projectId?: string | null;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const content = text.trim();
    if (!content) return;
    setSaving(true);
    try {
      await createMemory({
        content,
        sourceType: "teach",
        primaryPersonId: personId ?? null,
        projectId: projectId ?? null,
      });
      setText("");
      toast({ title: "Remembered" });
      onSaved();
    } catch (err) {
      toast({
        title: "Could not save memory",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/45">
        <BookmarkPlus className="h-3.5 w-3.5 text-emerald-300" />
        Teach Recall
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Remember: the city reviewer is Marisol…"
        rows={2}
        className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50"
      />
      <button
        type="button"
        disabled={saving || !text.trim()}
        onClick={() => void save()}
        className="mt-2 rounded-full bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
      >
        Remember this
      </button>
    </section>
  );
}
