import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { BookMarked, Plus, X } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import {
  createKnowledge,
  listKnowledge,
  updateKnowledge,
  type KnowledgeRecord,
} from "@/lib/recall-api";
import {
  NoteTagList,
  parsePersonTag,
  resolvePersonIdByName,
} from "@/components/PersonTagLink";
import { PersonTagger } from "@/components/PersonTagger";
import { toast } from "@/hooks/use-toast";
import {
  askPath,
  knowledgePath,
  notesPath,
  peoplePath,
  readSearchParam,
  tasksPath,
} from "@/lib/recall-nav";

const ITEM_TYPES = ["note", "procedure", "reference", "snippet", "contact"] as const;

const TYPE_STYLES: Record<string, string> = {
  procedure: "text-emerald-300 bg-emerald-500/10",
  reference: "text-sky-300 bg-sky-500/10",
  snippet: "text-violet-300 bg-violet-500/10",
  contact: "text-amber-300 bg-amber-500/10",
  note: "text-white/60 bg-white/5",
};

export function Knowledge() {
  const [location, navigate] = useLocation();
  const [items, setItems] = useState<KnowledgeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<KnowledgeRecord | null>(null);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [itemType, setItemType] = useState<string>("note");
  const [tagsText, setTagsText] = useState("");
  const [saving, setSaving] = useState(false);
  const openedFromQuery = useRef(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listKnowledge();
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setPersonFilter(readSearchParam("person")?.trim() || null);
  }, [location]);

  useEffect(() => {
    if (loading || openedFromQuery.current || items.length === 0) return;
    const itemId = readSearchParam("item");
    if (!itemId) return;
    const hit = items.find((i) => i.id === itemId);
    if (hit) {
      setSelected(hit);
      setFilter("all");
      openedFromQuery.current = true;
    }
  }, [loading, items]);

  const filtered = useMemo(() => {
    const byType = filter === "all" ? items : items.filter((i) => i.itemType === filter);
    if (!personFilter) return byType;
    const lower = personFilter.toLowerCase();
    return byType.filter((item) => {
      if (item.primaryPersonName) {
        const n = item.primaryPersonName.toLowerCase();
        if (n === lower || n.includes(lower) || lower.includes(n)) return true;
      }
      return item.tags.some((tag) => {
        const name = parsePersonTag(tag);
        if (!name) return false;
        const n = name.toLowerCase();
        return n === lower || n.includes(lower) || lower.includes(n);
      });
    });
  }, [items, filter, personFilter]);

  const save = async () => {
    if (!title.trim()) {
      toast({ title: "Give it a title", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createKnowledge({
        title: title.trim(),
        content: content.trim(),
        itemType,
        tags: tagsText
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      toast({ title: "Saved to knowledge vault" });
      setCreating(false);
      setTitle("");
      setContent("");
      setItemType("note");
      setTagsText("");
      await load();
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

  const saveSelectedTags = async (tags: string[]) => {
    if (!selected) return;
    const prev = selected;
    setSelected({ ...selected, tags });
    setItems((items) =>
      items.map((i) => (i.id === prev.id ? { ...i, tags } : i)),
    );
    try {
      const updated = await updateKnowledge(prev.id, { tags });
      setSelected(updated);
      setItems((items) => items.map((i) => (i.id === updated.id ? updated : i)));
    } catch {
      setSelected(prev);
      setItems((items) => items.map((i) => (i.id === prev.id ? prev : i)));
      toast({ title: "Could not update tags", variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#0a0a0f] p-4 md:p-8 text-white">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">Vault</p>
              <h1 className="mt-2 text-3xl font-semibold">Knowledge</h1>
              <p className="mt-2 text-white/50">
                Reusable procedures, references, and snippets Recall can recall on demand.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
            >
              <Plus size={16} />
              Add
            </button>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {["all", ...ITEM_TYPES].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilter(t)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  filter === t ? "bg-indigo-500 text-white" : "border border-white/10 text-white/55 hover:bg-white/5"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {personFilter && (
            <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
              <span>
                Showing knowledge tagged{" "}
                <span className="font-medium">{personFilter}</span>
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      askPath({
                        q: `What do I know about ${personFilter}? What am I waiting on from them?`,
                      }),
                    )
                  }
                  className="rounded-lg px-1.5 py-0.5 text-sky-200/80 hover:bg-sky-500/20 hover:text-white"
                >
                  Ask
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void resolvePersonIdByName(personFilter).then((id) => {
                      navigate(id ? tasksPath({ personId: id }) : tasksPath());
                    });
                  }}
                  className="rounded-lg px-1.5 py-0.5 text-sky-200/80 hover:bg-sky-500/20 hover:text-white"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => navigate(notesPath({ person: personFilter }))}
                  className="rounded-lg px-1.5 py-0.5 text-sky-200/80 hover:bg-sky-500/20 hover:text-white"
                >
                  Notes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void resolvePersonIdByName(personFilter).then((id) => {
                      navigate(id ? peoplePath({ personId: id }) : peoplePath());
                    });
                  }}
                  className="rounded-lg px-1.5 py-0.5 text-sky-200/80 hover:bg-sky-500/20 hover:text-white"
                >
                  People
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPersonFilter(null);
                    navigate(knowledgePath());
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-sky-200/80 hover:bg-sky-500/20 hover:text-white"
                >
                  <X size={12} />
                  Clear
                </button>
              </div>
            </div>
          )}

          {loading && <p className="mt-8 text-white/40">Loading…</p>}
          {!loading && filtered.length === 0 && (
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-white/45">
              {personFilter
                ? `No knowledge tagged to ${personFilter}.`
                : "Nothing here yet. Capture a procedure or reference you want to reuse."}
            </div>
          )}

          <div className="mt-6 space-y-3">
            {filtered.map((item) => (
              <article
                key={item.id}
                className="cursor-pointer rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:border-white/20"
                onClick={() => setSelected(item)}
              >
                <div className="flex items-start gap-3">
                  <BookMarked size={18} className="mt-0.5 flex-shrink-0 text-indigo-300" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{item.title}</h2>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${TYPE_STYLES[item.itemType] ?? TYPE_STYLES.note}`}>
                        {item.itemType}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-white/50">{item.content || "No content."}</p>
                    {item.tags.length > 0 && (
                      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                        <NoteTagList
                          tags={item.tags}
                          limit={6}
                          onPersonClick={(name) =>
                            navigate(knowledgePath({ person: name }))
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>

      {creating && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60" onClick={() => setCreating(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-white/10 bg-[#0f0f16] p-5 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Add to knowledge</h2>
              <button type="button" onClick={() => setCreating(false)} className="text-white/50 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-indigo-500/50"
              />
              <select
                value={itemType}
                onChange={(e) => setItemType(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-indigo-500/50"
              >
                {ITEM_TYPES.map((t) => (
                  <option key={t} value={t} className="bg-[#0f0f16]">
                    {t}
                  </option>
                ))}
              </select>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={6}
                placeholder="Content…"
                className="w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm outline-none focus:border-indigo-500/50"
              />
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="Tags (comma separated)"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-indigo-500/50"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/60 hover:text-white">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60" onClick={() => setSelected(null)} />
          <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-[#0f0f16] p-5 text-white shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs ${TYPE_STYLES[selected.itemType] ?? TYPE_STYLES.note}`}>
                  {selected.itemType}
                </span>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-white/50 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="mt-3">
              <PersonTagger tags={selected.tags} onChange={(tags) => void saveSelectedTags(tags)} />
            </div>
            <div className="mt-3 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-white/75">
              {selected.content || "No content."}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
