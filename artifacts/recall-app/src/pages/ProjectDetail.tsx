import React, { useCallback, useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { getProject } from "@workspace/api-client-react";
import { AppLayout } from "@/components/AppLayout";
import { ProjectContextCard } from "@/components/ProjectContextCard";
import { SubjectTimelineCard } from "@/components/SubjectTimelineCard";
import type { RecallCaptureItem, RecallNote, RecallProject, RecallTask } from "@/lib/recall-context";
import {
  fetchProjectContext,
  linkProjectSource,
  listProjectSources,
  searchProjectSources,
  unlinkProjectSource,
  type ProjectContext,
  type ProjectSourceRecord,
} from "@/lib/recall-api";
import { toast } from "@/hooks/use-toast";

type ProjectDetailData = {
  project: RecallProject;
  notes: RecallNote[];
  tasks: RecallTask[];
  captures: RecallCaptureItem[];
};

export function ProjectDetail() {
  const [, params] = useRoute("/projects/:projectId");
  const [detail, setDetail] = useState<ProjectDetailData | null>(null);
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [mail, setMail] = useState<ProjectSourceRecord[]>([]);
  const [transactions, setTransactions] = useState<ProjectSourceRecord[]>([]);
  const [searchType, setSearchType] = useState<"gmail_message" | "finance_transaction">(
    "gmail_message",
  );
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<ProjectSourceRecord[]>([]);
  const [searching, setSearching] = useState(false);

  const projectId = params?.projectId;

  const reloadSources = useCallback(async () => {
    if (!projectId) return;
    try {
      const sources = await listProjectSources(projectId);
      setMail(sources.mail);
      setTransactions(sources.transactions);
    } catch (err) {
      toast({
        title: "Could not load linked sources",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void getProject(projectId).then((res) => setDetail(res as ProjectDetailData));
    void fetchProjectContext(projectId)
      .then(setContext)
      .catch(() => setContext(null));
    void reloadSources();
  }, [projectId, reloadSources]);

  const runSearch = async () => {
    if (!projectId || searchQ.trim().length < 2) return;
    setSearching(true);
    try {
      const res = await searchProjectSources(projectId, searchQ.trim(), searchType);
      setSearchResults(res.results);
    } catch (err) {
      toast({
        title: "Search failed",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSearching(false);
    }
  };

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#0a0a0f] p-4 md:p-8 text-white">
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
                <Metric label="Linked sources" value={mail.length + transactions.length} />
              </div>

              {context && (
                <section className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <div>
                    <h2 className="text-lg font-semibold">Project pulse</h2>
                    <p className="mt-1 text-sm text-white/55">{context.summary}</p>
                  </div>

                  {context.nextBestAction && (
                    <div className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
                        Next best action
                      </div>
                      <Link
                        href={context.nextBestAction.href}
                        className="mt-1 block text-sm font-medium text-white hover:underline"
                      >
                        {context.nextBestAction.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-white/50">
                        {context.nextBestAction.reason} · source: {context.nextBestAction.sourceLabel}
                      </p>
                    </div>
                  )}

                  {context.risks.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-white/60">Risks</h3>
                      <ul className="mt-1.5 space-y-1.5">
                        {context.risks.map((r) => (
                          <li key={r.label} className="flex items-baseline gap-2 text-sm">
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                                r.severity === "high"
                                  ? "border-red-400/30 bg-red-500/15 text-red-300"
                                  : "border-amber-400/30 bg-amber-500/15 text-amber-300"
                              }`}
                            >
                              {r.severity}
                            </span>
                            <Link href={r.href} className="truncate text-white/80 hover:underline">
                              {r.label}
                            </Link>
                            <span className="hidden text-xs text-white/40 sm:inline">{r.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="grid gap-6 md:grid-cols-2">
                    <div>
                      <h3 className="text-sm font-medium text-white/60">
                        Blockers &amp; follow-ups
                      </h3>
                      {context.blockers.length === 0 && context.waitingItems.length === 0 ? (
                        <p className="mt-1.5 text-sm text-white/35">No open follow-ups.</p>
                      ) : (
                        <ul className="mt-1.5 space-y-1.5">
                          {context.waitingItems.map((w) => (
                            <li key={w.id} className="flex items-baseline justify-between gap-3 text-sm">
                              <Link href={w.href} className="truncate text-white/80 hover:underline">
                                {w.title}
                              </Link>
                              <span className="shrink-0 text-xs text-white/40">{w.detail}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-white/60">Deadlines</h3>
                      {context.deadlines.length === 0 ? (
                        <p className="mt-1.5 text-sm text-white/35">No open deadlines.</p>
                      ) : (
                        <ul className="mt-1.5 space-y-1.5">
                          {context.deadlines.map((d) => (
                            <li key={d.id} className="flex items-baseline justify-between gap-3 text-sm">
                              <Link href={d.href} className="truncate text-white/80 hover:underline">
                                {d.title}
                              </Link>
                              <span className="shrink-0 text-xs text-white/40">{d.detail}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {context.linkedPeople.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-white/60">People</h3>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {context.linkedPeople.map((p) =>
                          p.href ? (
                            <Link
                              key={p.name}
                              href={p.href}
                              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/75 hover:bg-white/10"
                              title={p.via.join(", ")}
                            >
                              {p.name}
                            </Link>
                          ) : (
                            <span
                              key={p.name}
                              className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/45"
                              title={`${p.via.join(", ")} (no People record)`}
                            >
                              {p.name}
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                  )}

                  {context.decisions.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-white/60">Recent decisions</h3>
                      <ul className="mt-1.5 space-y-1.5">
                        {context.decisions.map((d, i) => (
                          <li key={`${d.at}-${i}`} className="flex items-baseline gap-3 text-sm">
                            <span className="w-20 shrink-0 text-xs text-white/40">
                              {d.at.slice(0, 10)}
                            </span>
                            {d.href ? (
                              <Link href={d.href} className="truncate text-white/80 hover:underline">
                                {d.label}
                                {d.detail ? `: ${d.detail}` : ""}
                              </Link>
                            ) : (
                              <span className="truncate text-white/80">
                                {d.label}
                                {d.detail ? `: ${d.detail}` : ""}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              )}

              <div className="mt-8">
                <ProjectContextCard
                  notes={detail.notes}
                  tasks={detail.tasks}
                  captures={detail.captures}
                />
              </div>

              <div className="mt-8">
                <SubjectTimelineCard subjectType="project" subjectId={projectId!} />
              </div>

              <section className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h2 className="text-lg font-semibold">Linked mail &amp; transactions</h2>
                <p className="text-sm text-white/45">
                  Search synced Gmail or finance records and link them to this project.
                </p>

                <div className="flex flex-wrap gap-2">
                  <select
                    value={searchType}
                    onChange={(e) =>
                      setSearchType(e.target.value as "gmail_message" | "finance_transaction")
                    }
                    className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  >
                    <option value="gmail_message">Mail</option>
                    <option value="finance_transaction">Transactions</option>
                  </select>
                  <input
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void runSearch();
                    }}
                    placeholder="Search…"
                    className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void runSearch()}
                    disabled={searching || searchQ.trim().length < 2}
                    className="rounded-xl bg-indigo-500/80 px-3 py-2 text-sm disabled:opacity-40"
                  >
                    {searching ? "Searching…" : "Search"}
                  </button>
                </div>

                {searchResults.length > 0 && (
                  <ul className="space-y-1.5">
                    {searchResults.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm hover:bg-white/5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-white/80">{r.title}</p>
                          <p className="text-xs text-white/40">
                            {r.date ?? "No date"}
                            {r.amount != null ? ` · $${r.amount.toFixed(2)}` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 rounded-lg bg-indigo-500/20 px-2 py-1 text-xs text-indigo-200"
                          onClick={() =>
                            void linkProjectSource(projectId!, r.id).then(async () => {
                              setSearchResults((prev) => prev.filter((x) => x.id !== r.id));
                              await reloadSources();
                            })
                          }
                        >
                          Link
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="grid gap-6 md:grid-cols-2">
                  <SourceList
                    title="Mail"
                    items={mail}
                    onUnlink={(id) =>
                      void unlinkProjectSource(projectId!, id).then(reloadSources)
                    }
                  />
                  <SourceList
                    title="Transactions"
                    items={transactions}
                    onUnlink={(id) =>
                      void unlinkProjectSource(projectId!, id).then(reloadSources)
                    }
                  />
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function SourceList({
  title,
  items,
  onUnlink,
}: {
  title: string;
  items: ProjectSourceRecord[];
  onUnlink: (id: string) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-white/60">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-white/35">None linked.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/5 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate">{item.title}</p>
                <p className="text-xs text-white/40">
                  {item.date ?? ""}
                  {item.amount != null ? ` · $${item.amount.toFixed(2)}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="text-xs text-white/40 hover:text-white/70"
                onClick={() => onUnlink(item.id)}
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
