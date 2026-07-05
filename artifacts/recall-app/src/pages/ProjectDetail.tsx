import React, { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { getProject } from "@workspace/api-client-react";
import { AppLayout } from "@/components/AppLayout";
import { notesPath, tasksPath } from "@/lib/recall-nav";
import type { RecallCaptureItem, RecallNote, RecallProject, RecallTask } from "@/lib/recall-context";

type ProjectDetailData = {
  project: RecallProject;
  notes: RecallNote[];
  tasks: RecallTask[];
  captures: RecallCaptureItem[];
};

export function ProjectDetail() {
  const [, params] = useRoute("/projects/:projectId");
  const [detail, setDetail] = useState<ProjectDetailData | null>(null);

  useEffect(() => {
    if (!params?.projectId) return;
    void getProject(params.projectId).then((res) => setDetail(res as ProjectDetailData));
  }, [params?.projectId]);

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#0a0a0f] p-8 text-white">
        <div className="mx-auto max-w-6xl">
          <Link href="/projects" className="text-sm text-indigo-300 no-underline">
            Back to projects
          </Link>
          {!detail ? (
            <div className="mt-8 text-white/40">Loading project...</div>
          ) : (
            <>
              <h1 className="mt-4 text-3xl font-semibold">{detail.project.name}</h1>
              {detail.project.description && (
                <p className="mt-2 text-white/55">{detail.project.description}</p>
              )}

              <div className="mt-8 grid gap-4 md:grid-cols-4">
                <Metric label="Notes" value={detail.project.noteCount} />
                <Metric label="Tasks" value={detail.project.taskCount} />
                <Metric label="Captures" value={detail.project.captureCount} />
                <Metric label="Attachments" value={detail.project.attachmentCount} />
              </div>

              <div className="mt-8 grid gap-6 lg:grid-cols-3">
                <Section title="Notes">
                  {detail.notes.slice(0, 8).map((note) => (
                    <Link key={note.id} href={notesPath({ noteId: note.id })} className="block rounded-xl bg-white/[0.04] p-3 text-sm text-white/75 no-underline">
                      {note.title}
                    </Link>
                  ))}
                </Section>
                <Section title="Tasks">
                  {detail.tasks.slice(0, 8).map((task) => (
                    <Link key={task.id} href={tasksPath({ taskId: task.id })} className="block rounded-xl bg-white/[0.04] p-3 text-sm text-white/75 no-underline">
                      {task.title}
                    </Link>
                  ))}
                </Section>
                <Section title="Recent Captures">
                  {detail.captures.slice(0, 8).map((item) => (
                    <div key={item.id} className="rounded-xl bg-white/[0.04] p-3 text-sm text-white/75">
                      {item.cleanedTitle}
                    </div>
                  ))}
                </Section>
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-white/45">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-white/45">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
