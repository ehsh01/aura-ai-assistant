import React, { useEffect, useRef, useState } from "react";
import { FileText, Plus, Sparkles, Upload, X } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import {
  createDocument,
  listDocuments,
  summarizeText,
  type DocumentRecord,
} from "@/lib/recall-api";
import {
  formatBytes,
  readImportFile,
  type CsvPreview,
} from "@/lib/document-import";
import { EvidenceDrawer } from "@/components/EvidenceDrawer";
import { toast } from "@/hooks/use-toast";
import { readSearchParam } from "@/lib/recall-nav";

export function Documents() {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<DocumentRecord | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<DocumentRecord | null>(null);
  const openedFromQuery = useRef(false);

  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [summary, setSummary] = useState("");
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const [fileMeta, setFileMeta] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listDocuments();
      setDocs(res.documents);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (loading || openedFromQuery.current || docs.length === 0) return;
    const docId = readSearchParam("doc");
    if (!docId) return;
    const hit = docs.find((d) => d.id === docId);
    if (hit) {
      setSelected(hit);
      openedFromQuery.current = true;
    }
  }, [loading, docs]);

  const resetForm = () => {
    setFileName("");
    setText("");
    setSummary("");
    setCsvPreview(null);
    setFileMeta(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onFile = async (file: File) => {
    try {
      const result = await readImportFile(file);
      setFileName(result.fileName);
      setText(result.text);
      setCsvPreview(result.csv);
      setFileMeta(`${formatBytes(file.size)}${result.binaryOnly ? " · binary (name only)" : ""}`);
      setSummary("");
      if (result.binaryOnly) {
        toast({
          title: "File attached by name",
          description: "This type can’t be read as text. Paste content below if you want it searchable.",
        });
      } else if (result.csv) {
        toast({
          title: "CSV loaded",
          description: `${result.csv.rowCount} rows · ${result.csv.headers.length} columns`,
        });
      }
    } catch {
      toast({ title: "Could not read file", variant: "destructive" });
    }
  };

  const runSummarize = async () => {
    if (!text.trim()) return;
    setSummarizing(true);
    try {
      const res = await summarizeText(text, 500);
      setSummary(res.summary);
    } catch {
      toast({ title: "Could not summarize", variant: "destructive" });
    } finally {
      setSummarizing(false);
    }
  };

  const save = async () => {
    if (!fileName.trim()) {
      toast({ title: "Give the document a name", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createDocument({
        fileName: fileName.trim(),
        extractedText: text.trim() || null,
        summary: summary.trim() || null,
      });
      toast({ title: "Document saved" });
      setCreating(false);
      resetForm();
      await load();
    } catch (err) {
      toast({
        title: "Could not save document",
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
        <div className="mx-auto max-w-4xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">Library</p>
              <h1 className="mt-2 text-3xl font-semibold">Documents</h1>
              <p className="mt-2 text-white/50">
                Drop CSV, Markdown, or text files — Recall can search, summarize, and cite them.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setCreating(true);
              }}
              className="flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
            >
              <Plus size={16} />
              Add
            </button>
          </div>

          {loading && <p className="mt-8 text-white/40">Loading documents…</p>}
          {!loading && docs.length === 0 && (
            <button
              type="button"
              onClick={() => {
                resetForm();
                setCreating(true);
              }}
              className="mt-8 w-full rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-10 text-center text-white/45 transition-colors hover:border-indigo-500/40 hover:bg-indigo-500/5 hover:text-white/70"
            >
              <Upload className="mx-auto mb-3 text-indigo-300/70" size={28} />
              <p className="font-medium text-white/70">Import your first document</p>
              <p className="mt-1 text-sm">CSV, .txt, .md, or paste text</p>
            </button>
          )}

          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {docs.map((doc) => (
              <article
                key={doc.id}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:border-white/20"
              >
                <div className="flex items-start gap-3">
                  <FileText size={18} className="mt-0.5 flex-shrink-0 text-indigo-300" />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-semibold">{doc.fileName}</h2>
                    <p className="mt-1 line-clamp-2 text-sm text-white/50">
                      {doc.summary || doc.extractedText || "No preview available."}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelected(doc)}
                        className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/70 hover:bg-white/5"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => setEvidenceFor(doc)}
                        className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-indigo-200 hover:bg-white/5"
                      >
                        Evidence
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>

      {creating && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/60"
            onClick={() => setCreating(false)}
          />
          <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#0f0f16] p-5 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Add document</h2>
              <button type="button" onClick={() => setCreating(false)} className="text-white/50 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <input
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="Document name"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-indigo-500/50"
              />

              <div
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void onFile(f);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${
                  dragOver
                    ? "border-indigo-400 bg-indigo-500/10"
                    : "border-white/15 bg-black/20 hover:border-white/30"
                }`}
              >
                <Upload size={22} className="mb-2 text-indigo-300" />
                <p className="text-sm text-white/70">
                  Drop a file here, or click to browse
                </p>
                <p className="mt-1 text-xs text-white/35">
                  CSV, TXT, MD, JSON · up to ~200KB of text indexed
                </p>
                {fileMeta && (
                  <p className="mt-2 text-xs text-indigo-200/80">{fileMeta}</p>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.md,.json,.log,.tsv,text/*,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onFile(f);
                  }}
                />
              </div>

              {csvPreview && csvPreview.headers.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-white/10">
                  <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3 py-2">
                    <p className="text-xs font-medium text-white/60">
                      CSV preview · {csvPreview.rowCount} rows
                    </p>
                  </div>
                  <div className="max-h-40 overflow-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="border-b border-white/10 text-white/45">
                          {csvPreview.headers.slice(0, 6).map((h) => (
                            <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                              {h}
                            </th>
                          ))}
                          {csvPreview.headers.length > 6 && (
                            <th className="px-2 py-1.5">+{csvPreview.headers.length - 6}</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {csvPreview.sampleRows.map((row, i) => (
                          <tr key={i} className="border-b border-white/[0.04] text-white/70">
                            {row.slice(0, 6).map((cell, j) => (
                              <td key={j} className="max-w-[8rem] truncate px-2 py-1">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (csvPreview) setCsvPreview(null);
                }}
                rows={csvPreview ? 4 : 6}
                placeholder="Paste or edit the document text…"
                className="w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm outline-none focus:border-indigo-500/50"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runSummarize()}
                  disabled={summarizing || !text.trim()}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5 disabled:opacity-40"
                >
                  <Sparkles size={14} />
                  {summarizing ? "Summarizing…" : "AI summary"}
                </button>
              </div>
              {summary && (
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-sm outline-none"
                />
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/60 hover:text-white"
              >
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
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/60"
            onClick={() => setSelected(null)}
          />
          <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-[#0f0f16] p-5 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="truncate text-lg font-semibold">{selected.fileName}</h2>
              <button type="button" onClick={() => setSelected(null)} className="text-white/50 hover:text-white">
                <X size={18} />
              </button>
            </div>
            {selected.summary && (
              <p className="mt-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-sm text-white/80">
                {selected.summary}
              </p>
            )}
            <div className="mt-3 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-white/70">
              {selected.extractedText || "No extracted text stored for this document."}
            </div>
          </div>
        </div>
      )}

      <EvidenceDrawer
        open={evidenceFor != null}
        onClose={() => setEvidenceFor(null)}
        entityType="document"
        entityId={evidenceFor?.id ?? ""}
        title={evidenceFor?.fileName}
      />
    </AppLayout>
  );
}
