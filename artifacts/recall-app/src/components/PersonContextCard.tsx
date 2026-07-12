import React from "react";
import { Link } from "wouter";
import { Sparkles } from "lucide-react";
import type { WaitingOnRecord } from "@/lib/recall-api";
import {
  askPath,
  knowledgePath,
  memoryPath,
  notesPath,
  tasksPath,
} from "@/lib/recall-nav";

export type PersonContextOpenTask = {
  id: string;
  title: string;
  time: string | null;
};

export type PersonContextNote = {
  id: string;
  title: string;
  preview: string;
};

export type PersonContextKnowledge = {
  id: string;
  title: string;
  itemType: string;
};

export type PersonContextMemory = {
  id: string;
  title: string;
  domain: string;
};

type PersonContextCardProps = {
  displayName: string;
  personId: string;
  loading?: boolean;
  openTasks: PersonContextOpenTask[];
  taggedNotes: PersonContextNote[];
  taggedKnowledge: PersonContextKnowledge[];
  linkedMemories: PersonContextMemory[];
  waiting: WaitingOnRecord[];
  onFollowUp?: (item: WaitingOnRecord) => void;
  creatingFollowUpId?: string | null;
  /** Extra actions rendered under the Ask CTA (edit, etc.). */
  actions?: React.ReactNode;
};

/** Shared person-linked context: tasks, notes, knowledge, memories, waiting-on. */
export function PersonContextCard({
  displayName,
  personId,
  loading = false,
  openTasks,
  taggedNotes,
  taggedKnowledge,
  linkedMemories,
  waiting,
  onFollowUp,
  creatingFollowUpId = null,
  actions,
}: PersonContextCardProps) {
  const first = displayName.split(" ")[0] || displayName;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Link
          href={askPath({
            q: `What do I know about ${displayName}? What am I waiting on from them?`,
          })}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-200 no-underline hover:bg-indigo-500/30"
        >
          <Sparkles size={12} />
          Ask about {first}
        </Link>
        {openTasks.length > 0 && (
          <Link
            href={tasksPath({ personId })}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white/60 no-underline hover:bg-white/5 hover:text-white/80"
          >
            View tasks
          </Link>
        )}
        {actions}
      </div>

      {loading && <p className="text-xs text-white/40">Loading related records…</p>}

      <ContextSection title="Open tasks" empty="No linked open tasks.">
        {openTasks.length > 0 && (
          <ul className="space-y-1.5">
            {openTasks.map((t) => (
              <li key={t.id}>
                <Link
                  href={tasksPath({ taskId: t.id })}
                  className="block truncate text-sm text-indigo-200 no-underline hover:underline"
                >
                  {t.title}
                  {t.time ? <span className="ml-2 text-white/35">{t.time}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </ContextSection>

      <ContextSection title="Notes" empty="No notes linked to this person yet.">
        {taggedNotes.length > 0 && (
          <>
            <ul className="space-y-1.5">
              {taggedNotes.map((n) => (
                <li key={n.id}>
                  <Link href={notesPath({ noteId: n.id })} className="block no-underline">
                    <p className="truncate text-sm text-indigo-200 hover:underline">{n.title}</p>
                    {n.preview && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-white/40">{n.preview}</p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href={notesPath({ person: displayName })}
              className="mt-2 inline-block text-xs text-sky-300 no-underline hover:underline"
            >
              View all notes for {first}
            </Link>
          </>
        )}
      </ContextSection>

      {taggedKnowledge.length > 0 && (
        <ContextSection title="Knowledge">
          <ul className="space-y-1.5">
            {taggedKnowledge.map((k) => (
              <li key={k.id}>
                <Link
                  href={knowledgePath({ knowledgeId: k.id })}
                  className="block truncate text-sm text-indigo-200 no-underline hover:underline"
                >
                  {k.title}
                  <span className="ml-2 text-white/35">{k.itemType}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href={knowledgePath({ person: displayName })}
            className="mt-2 inline-block text-xs text-sky-300 no-underline hover:underline"
          >
            View all knowledge for {first}
          </Link>
        </ContextSection>
      )}

      {linkedMemories.length > 0 && (
        <ContextSection title="Life Memory">
          <ul className="space-y-1.5">
            {linkedMemories.map((m) => (
              <li key={m.id}>
                <Link
                  href={memoryPath({ memoryId: m.id })}
                  className="block truncate text-sm text-indigo-200 no-underline hover:underline"
                >
                  {m.title}
                  <span className="ml-2 text-white/35">{m.domain}</span>
                </Link>
              </li>
            ))}
          </ul>
        </ContextSection>
      )}

      <ContextSection title="Waiting on" empty="Nothing waiting from them.">
        {waiting.length > 0 && (
          <ul className="space-y-2">
            {waiting.map((w) => (
              <li
                key={w.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-amber-500/15 bg-amber-500/5 px-3 py-2"
              >
                <Link href={w.href} className="min-w-0 flex-1 no-underline">
                  <p className="truncate text-sm font-medium text-white">{w.item}</p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-white/45">{w.evidenceText}</p>
                </Link>
                {onFollowUp && (
                  <button
                    type="button"
                    onClick={() => onFollowUp(w)}
                    disabled={creatingFollowUpId === w.id}
                    className="flex-shrink-0 rounded-lg bg-indigo-500 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
                  >
                    {creatingFollowUpId === w.id ? "…" : "Follow up"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </ContextSection>
    </div>
  );
}

function ContextSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: string;
  children?: React.ReactNode;
}) {
  const hasContent = Boolean(children);
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
        {title}
      </h3>
      {hasContent ? children : empty ? <p className="text-sm text-white/35">{empty}</p> : null}
    </div>
  );
}
