import React from "react";
import { Link } from "wouter";
import { notesPath, tasksPath } from "@/lib/recall-nav";
import type { RecallCaptureItem, RecallNote, RecallTask } from "@/lib/recall-context";

type ProjectContextCardProps = {
  notes: RecallNote[];
  tasks: RecallTask[];
  captures: RecallCaptureItem[];
  noteLimit?: number;
  taskLimit?: number;
  captureLimit?: number;
};

/** Shared project-linked context columns for Project detail. */
export function ProjectContextCard({
  notes,
  tasks,
  captures,
  noteLimit = 8,
  taskLimit = 8,
  captureLimit = 8,
}: ProjectContextCardProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Section title="Notes">
        {notes.slice(0, noteLimit).map((note) => (
          <Link
            key={note.id}
            href={notesPath({ noteId: note.id })}
            className="block rounded-xl bg-white/[0.04] p-3 text-sm text-white/75 no-underline hover:bg-white/[0.07]"
          >
            {note.title}
          </Link>
        ))}
        {notes.length === 0 && <Empty>No notes in this project yet.</Empty>}
      </Section>
      <Section title="Tasks">
        {tasks.slice(0, taskLimit).map((task) => (
          <Link
            key={task.id}
            href={tasksPath({ taskId: task.id })}
            className="block rounded-xl bg-white/[0.04] p-3 text-sm text-white/75 no-underline hover:bg-white/[0.07]"
          >
            {task.title}
          </Link>
        ))}
        {tasks.length === 0 && <Empty>No tasks in this project yet.</Empty>}
      </Section>
      <Section title="Recent captures">
        {captures.slice(0, captureLimit).map((item) => (
          <div key={item.id} className="rounded-xl bg-white/[0.04] p-3 text-sm text-white/75">
            {item.cleanedTitle}
          </div>
        ))}
        {captures.length === 0 && <Empty>No captures linked yet.</Empty>}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-white/35">{children}</p>;
}
