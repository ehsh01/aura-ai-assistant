import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { createProject, listProjects } from "@workspace/api-client-react";
import { AppLayout } from "@/components/AppLayout";
import { toast } from "@/hooks/use-toast";
import type { RecallProject } from "@/lib/recall-context";

export function Projects() {
  const [projects, setProjects] = useState<RecallProject[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listProjects();
      setProjects(res.projects as RecallProject[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const addProject = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await createProject({ name: trimmed });
      setName("");
      await load();
    } catch {
      toast({ title: "Could not create project", variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#0a0a0f] p-4 md:p-8 text-white">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">Command center</p>
          <h1 className="mt-2 text-3xl font-semibold">Projects</h1>
          <p className="mt-2 text-white/50">
            Group notes, tasks, captures, attachments, and people above notebooks.
          </p>

          <div className="mt-6 flex gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New project, e.g. UM Psychiatry IT"
              className="flex-1 bg-transparent px-3 text-sm text-white outline-none placeholder:text-white/30"
            />
            <button
              type="button"
              onClick={() => void addProject()}
              className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
            >
              Add project
            </button>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {loading && <div className="text-white/40">Loading projects...</div>}
            {!loading && projects.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-white/45">
                No projects yet. Create one for permits, IT work, home projects, or personal areas.
              </div>
            )}
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 no-underline transition hover:bg-white/[0.07]"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold text-white">{project.name}</h2>
                  <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-white/45">
                    {project.status}
                  </span>
                </div>
                {project.description && (
                  <p className="mt-2 text-sm text-white/55">{project.description}</p>
                )}
                <div className="mt-5 grid grid-cols-4 gap-2 text-center text-xs text-white/45">
                  <div><b className="block text-white">{project.noteCount}</b>notes</div>
                  <div><b className="block text-white">{project.taskCount}</b>tasks</div>
                  <div><b className="block text-white">{project.captureCount}</b>captures</div>
                  <div><b className="block text-white">{project.attachmentCount}</b>files</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
