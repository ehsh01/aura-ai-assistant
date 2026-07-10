import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Brain, Download, Pin, Trash2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import {
  classifyMemory,
  createMemory,
  deleteMemory,
  exportLifeMemoryMarkdown,
  LIFE_MEMORY_DOMAINS,
  listMemories,
  updateMemory,
  type LifeMemoryDomain,
  type LifeMemoryRecord,
} from "@/lib/recall-api";
import { askPath, memoryPath, readSearchParam } from "@/lib/recall-nav";
import { toast } from "@/hooks/use-toast";

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

export function Memory() {
  const [location, navigate] = useLocation();
  const [items, setItems] = useState<LifeMemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LifeMemoryRecord | null>(null);
  const [teachText, setTeachText] = useState("");
  const [suggestedDomain, setSuggestedDomain] = useState<LifeMemoryDomain | null>(null);
  const [suggestedTitle, setSuggestedTitle] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const openedFromQuery = useRef(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listMemories();
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const d = readSearchParam("domain");
    if (d) setDomainFilter(d);
  }, [location]);

  useEffect(() => {
    if (loading || openedFromQuery.current || items.length === 0) return;
    const memoryId = readSearchParam("memory");
    if (!memoryId) return;
    const hit = items.find((i) => i.id === memoryId);
    if (hit) {
      setSelected(hit);
      setDomainFilter("all");
      openedFromQuery.current = true;
    }
  }, [loading, items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (domainFilter !== "all" && item.domain !== domainFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.content.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [items, domainFilter, search]);

  const runClassify = async (text: string) => {
    if (!text.trim()) {
      setSuggestedDomain(null);
      setSuggestedTitle("");
      return;
    }
    setClassifying(true);
    try {
      const res = await classifyMemory(text.trim());
      setSuggestedDomain(res.domain);
      setSuggestedTitle(res.title);
    } catch {
      setSuggestedDomain("other");
      setSuggestedTitle(text.trim().split(/\r?\n/).find(Boolean)?.slice(0, 80) ?? "Memory");
    } finally {
      setClassifying(false);
    }
  };

  const teach = async () => {
    const content = teachText.trim();
    if (!content) {
      toast({ title: "Paste something to remember", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const created = await createMemory({
        content,
        title: suggestedTitle || undefined,
        domain: suggestedDomain,
        sourceType: "teach",
      });
      toast({ title: "Saved forever", description: `Filed under ${DOMAIN_LABELS[created.domain]}.` });
      setTeachText("");
      setSuggestedDomain(null);
      setSuggestedTitle("");
      await load();
      setSelected(created);
      navigate(memoryPath({ memoryId: created.id }));
    } catch (err) {
      toast({
        title: "Could not save memory",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const exportLifeFile = async () => {
    setExporting(true);
    try {
      const md = await exportLifeMemoryMarkdown();
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Recall-Life-Memory.md";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Life File downloaded" });
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const togglePin = async (item: LifeMemoryRecord) => {
    try {
      const updated = await updateMemory(item.id, { pinned: !item.pinned });
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
      if (selected?.id === item.id) setSelected(updated);
    } catch {
      toast({ title: "Could not update pin", variant: "destructive" });
    }
  };

  const remove = async (item: LifeMemoryRecord) => {
    if (!window.confirm(`Delete “${item.title}”?`)) return;
    try {
      await deleteMemory(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      if (selected?.id === item.id) setSelected(null);
      toast({ title: "Memory deleted" });
    } catch {
      toast({ title: "Could not delete", variant: "destructive" });
    }
  };

  const saveSelected = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await updateMemory(selected.id, {
        title: selected.title,
        content: selected.content,
        domain: selected.domain,
        pinned: selected.pinned,
      });
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setSelected(updated);
      toast({ title: "Memory updated" });
    } catch (err) {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#0a0a0f] p-4 md:p-8 text-white">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">Permanent</p>
              <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold">
                <Brain className="text-indigo-300" size={28} />
                Memory
              </h1>
              <p className="mt-2 max-w-xl text-white/50">
                Teach Recall once — cars, family, preferences, procedures — and ask forever.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={askPath({ q: "What do you know about my life?" })}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs text-indigo-200 no-underline hover:bg-white/5"
              >
                Ask about my life
              </Link>
              <button
                type="button"
                onClick={() => void exportLifeFile()}
                disabled={exporting}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/5 disabled:opacity-50"
              >
                <Download size={14} />
                {exporting ? "Exporting…" : "Export Life File"}
              </button>
            </div>
          </div>

          <section className="mt-8 rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.06] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-indigo-200/80">
              Teach Recall
            </h2>
            <textarea
              value={teachText}
              onChange={(e) => setTeachText(e.target.value)}
              onBlur={() => void runClassify(teachText)}
              rows={4}
              placeholder="My wife’s birthday is March 12… / Tesla VIN is … / Prefer aisle seats…"
              className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-indigo-400/50"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="text-xs text-white/50">
                Domain
                <select
                  value={suggestedDomain ?? ""}
                  onChange={(e) =>
                    setSuggestedDomain((e.target.value || null) as LifeMemoryDomain | null)
                  }
                  className="ml-2 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white"
                >
                  <option value="">{classifying ? "Classifying…" : "Auto"}</option>
                  {LIFE_MEMORY_DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {DOMAIN_LABELS[d]}
                    </option>
                  ))}
                </select>
              </label>
              {suggestedTitle && (
                <span className="text-xs text-white/45">Title: {suggestedTitle}</span>
              )}
              <button
                type="button"
                onClick={() => void teach()}
                disabled={saving || !teachText.trim()}
                className="ml-auto rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save forever"}
              </button>
            </div>
          </section>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setDomainFilter("all")}
              className={`rounded-full px-3 py-1 text-xs ${
                domainFilter === "all"
                  ? "bg-indigo-500/30 text-indigo-100"
                  : "bg-white/5 text-white/50 hover:bg-white/10"
              }`}
            >
              All
            </button>
            {LIFE_MEMORY_DOMAINS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDomainFilter(d)}
                className={`rounded-full px-3 py-1 text-xs ${
                  domainFilter === d
                    ? "bg-indigo-500/30 text-indigo-100"
                    : "bg-white/5 text-white/50 hover:bg-white/10"
                }`}
              >
                {DOMAIN_LABELS[d]}
              </button>
            ))}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search memories…"
              className="ml-auto min-w-[180px] rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-400/40"
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
            <div className="space-y-2">
              {loading && <p className="text-white/40">Loading memories…</p>}
              {!loading && filtered.length === 0 && (
                <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-white/45">
                  No memories yet. Teach Recall something permanent above.
                </p>
              )}
              {filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelected(item);
                    navigate(memoryPath({ memoryId: item.id }), { replace: true });
                  }}
                  className={`w-full rounded-xl border p-4 text-left transition ${
                    selected?.id === item.id
                      ? "border-indigo-400/40 bg-indigo-500/10"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-indigo-300/70">
                        {DOMAIN_LABELS[item.domain]}
                        {item.pinned ? " · pinned" : ""}
                      </p>
                      <h3 className="mt-1 font-medium text-white">{item.title}</h3>
                      <p className="mt-1 line-clamp-2 text-sm text-white/50">{item.content}</p>
                    </div>
                    {item.pinned && <Pin size={14} className="shrink-0 text-amber-300" />}
                  </div>
                </button>
              ))}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              {!selected ? (
                <p className="text-sm text-white/40">Select a memory to edit.</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={selected.domain}
                      onChange={(e) =>
                        setSelected({
                          ...selected,
                          domain: e.target.value as LifeMemoryDomain,
                        })
                      }
                      className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white"
                    >
                      {LIFE_MEMORY_DOMAINS.map((d) => (
                        <option key={d} value={d}>
                          {DOMAIN_LABELS[d]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void togglePin(selected)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/60 hover:bg-white/5"
                    >
                      <Pin size={12} />
                      {selected.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(selected)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-500/20 px-2.5 py-1.5 text-xs text-red-300/80 hover:bg-red-500/10"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  </div>
                  <input
                    value={selected.title}
                    onChange={(e) => setSelected({ ...selected, title: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-medium text-white outline-none focus:border-indigo-400/40"
                  />
                  <textarea
                    value={selected.content}
                    onChange={(e) => setSelected({ ...selected, content: e.target.value })}
                    rows={12}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/85 outline-none focus:border-indigo-400/40"
                  />
                  <button
                    type="button"
                    onClick={() => void saveSelected()}
                    disabled={saving}
                    className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                  <p className="text-xs text-white/35">
                    Source: {selected.sourceType}
                    {selected.sourceId ? ` · ${selected.sourceId}` : ""}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
