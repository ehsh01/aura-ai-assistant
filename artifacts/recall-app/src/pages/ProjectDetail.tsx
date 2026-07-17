import React, { useCallback, useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { getProject } from "@workspace/api-client-react";
import { AppLayout } from "@/components/AppLayout";
import { ProjectContextCard } from "@/components/ProjectContextCard";
import type { RecallCaptureItem, RecallNote, RecallProject, RecallTask } from "@/lib/recall-context";
import {
  linkProjectSource,
  listProjectSources,
  searchProjectSources,
  unlinkProjectSource,
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

              <div className="mt-8">
                <ProjectContextCard
                  notes={detail.notes}
                  tasks={detail.tasks}
                  captures={detail.captures}
                />
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
