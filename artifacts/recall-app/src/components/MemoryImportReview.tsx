import React, { useMemo, useRef, useState } from "react";
import { FileUp, SkipForward, Check, ChevronLeft, ChevronRight, X, Sparkles } from "lucide-react";
import {
  classifyMemory,
  importMemories,
  LIFE_MEMORY_DOMAINS,
  type LifeMemoryDomain,
} from "@/lib/recall-api";
import {
  splitMarkdownIntoMemoryChunks,
  type MemoryImportDraft,
} from "@/lib/parse-life-md";
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

type Props = {
  onClose: () => void;
  onImported: () => void;
};

export function MemoryImportReview({ onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<MemoryImportDraft[]>([]);
  const [index, setIndex] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [refining, setRefining] = useState(false);

  const current = drafts[index] ?? null;
  const includedCount = useMemo(
    () => drafts.filter((d) => d.include && d.content.trim()).length,
    [drafts],
  );

  const updateCurrent = (patch: Partial<MemoryImportDraft>) => {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  };

  const refineCurrent = async () => {
    if (!current) return;
    setRefining(true);
    try {
      const res = await classifyMemory(`${current.title}\n\n${current.content}`);
      updateCurrent({
        domain: current.domain === "other" ? res.domain : current.domain,
        title:
          current.title === "Untitled" || current.title.length < 4
            ? res.title
            : current.title,
      });
      toast({ title: "Domain refined", description: DOMAIN_LABELS[res.domain] });
    } catch (err) {
      toast({
        title: "Could not refine",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setRefining(false);
    }
  };

  const onPickFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".md") && file.type !== "text/markdown") {
      toast({
        title: "Use a Markdown file",
        description: "Choose a .md file to import.",
        variant: "destructive",
      });
      return;
    }
    setPreparing(true);
    try {
      const text = await file.text();
      const chunks = splitMarkdownIntoMemoryChunks(text).map((c) => ({
        ...c,
        include: true,
      }));
      if (chunks.length === 0) {
        toast({
          title: "Nothing to import",
          description: "File looked empty.",
          variant: "destructive",
        });
        return;
      }
      setFileName(file.name);
      setDrafts(chunks);
      setIndex(0);
      toast({
        title: `Split into ${chunks.length} memories`,
        description: "Review each one, then import what you keep.",
      });
    } catch (err) {
      toast({
        title: "Could not read file",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPreparing(false);
    }
  };

  const importIncluded = async () => {
    const toImport = drafts.filter((d) => d.include && d.content.trim());
    if (toImport.length === 0) {
      toast({ title: "Nothing selected", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      const res = await importMemories({
        sourceId: fileName,
        items: toImport.map((d) => ({
          title: d.title.trim() || undefined,
          content: d.content.trim(),
          domain: d.domain,
        })),
      });
      toast({
        title: `Imported ${res.created} memor${res.created === 1 ? "y" : "ies"}`,
        description: res.failed > 0 ? `${res.failed} failed` : undefined,
      });
      onImported();
      onClose();
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const skipCurrent = () => {
    updateCurrent({ include: false });
    if (index < drafts.length - 1) setIndex(index + 1);
  };

  const keepAndNext = () => {
    updateCurrent({ include: true });
    if (index < drafts.length - 1) setIndex(index + 1);
  };

  return (
    <section className="mt-8 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-200/80">
            Import Life File
          </h2>
          <p className="mt-1 max-w-xl text-sm text-white/50">
            Upload a .md about you. Recall splits it by headings so you can check domain, title, and
            content one chunk at a time before saving forever.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-white/45 hover:bg-white/5 hover:text-white"
          aria-label="Close import"
        >
          <X size={16} />
        </button>
      </div>

      {drafts.length === 0 ? (
        <div className="mt-4">
          <input
            ref={fileRef}
            type="file"
            accept=".md,text/markdown,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickFile(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={preparing}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2.5 text-sm font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            <FileUp size={16} />
            {preparing ? "Reading…" : "Choose .md file"}
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/45">
            <span>
              {fileName} · chunk {index + 1} of {drafts.length}
            </span>
            <span>{includedCount} marked to import</span>
          </div>

          {current && (
            <div
              className={`rounded-xl border p-4 ${
                current.include
                  ? "border-emerald-500/30 bg-black/25"
                  : "border-white/10 bg-black/20 opacity-70"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 text-xs text-white/60">
                  <input
                    type="checkbox"
                    checked={current.include}
                    onChange={(e) => updateCurrent({ include: e.target.checked })}
                    className="rounded border-white/20"
                  />
                  Include this memory
                </label>
                <select
                  value={current.domain}
                  onChange={(e) =>
                    updateCurrent({ domain: e.target.value as LifeMemoryDomain })
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
                  disabled={refining}
                  onClick={() => void refineCurrent()}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/55 hover:bg-white/5 disabled:opacity-50"
                >
                  <Sparkles size={12} />
                  {refining ? "Refining…" : "Refine domain"}
                </button>
              </div>
              <input
                value={current.title}
                onChange={(e) => updateCurrent({ title: e.target.value })}
                className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-medium text-white outline-none focus:border-emerald-400/40"
              />
              <textarea
                value={current.content}
                onChange={(e) => updateCurrent({ content: e.target.value })}
                rows={10}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/85 outline-none focus:border-emerald-400/40"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-3 py-2 text-sm text-white/60 hover:bg-white/5 disabled:opacity-40"
            >
              <ChevronLeft size={16} />
              Back
            </button>
            <button
              type="button"
              onClick={skipCurrent}
              className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-3 py-2 text-sm text-white/55 hover:bg-white/5"
            >
              <SkipForward size={14} />
              Skip
            </button>
            <button
              type="button"
              onClick={keepAndNext}
              className="inline-flex items-center gap-1 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-500/25"
            >
              <Check size={14} />
              {index < drafts.length - 1 ? "Keep & next" : "Keep"}
            </button>
            {index < drafts.length - 1 && (
              <button
                type="button"
                onClick={() => setIndex((i) => Math.min(drafts.length - 1, i + 1))}
                className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-3 py-2 text-sm text-white/60 hover:bg-white/5"
              >
                Next
                <ChevronRight size={16} />
              </button>
            )}
            <button
              type="button"
              disabled={importing || includedCount === 0}
              onClick={() => void importIncluded()}
              className="ml-auto rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
            >
              {importing ? "Importing…" : `Import ${includedCount} selected`}
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setDrafts([]);
              setFileName(null);
              setIndex(0);
            }}
            className="text-xs text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
          >
            Choose a different file
          </button>
        </div>
      )}
    </section>
  );
}
