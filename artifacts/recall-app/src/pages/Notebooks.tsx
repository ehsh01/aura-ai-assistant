import React, { useRef, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import { useRecallData } from "@/context/RecallDataContext";
import { importEvernoteFiles } from "@/lib/evernote-import-ui";
import { notesPath } from "@/lib/recall-nav";
import { BookOpen, Download, Library, Loader2 } from "lucide-react";

export function Notebooks() {
  const { notebooks, importEnexUpload, isReady } = useRecallData();
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleEvernoteImport = (files: FileList | null) =>
    void importEvernoteFiles(files, {
      importing,
      setImporting,
      importFile: importEnexUpload,
      onSuccess: async () => {},
      onFinally: () => {
        if (importInputRef.current) importInputRef.current.value = "";
      },
    });

  return (
    <AppLayout>
      <div className="flex h-full flex-col bg-[#0a0a0f] text-white">
        <div className="flex items-center justify-between px-4 py-4 md:px-8 md:py-6 border-b border-white/[0.06]">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white/90">Notebooks</h1>
            <p className="text-sm text-white/40 mt-1">
              {isReady
                ? `${notebooks.length} notebook${notebooks.length === 1 ? "" : "s"}`
                : "Loading…"}
            </p>
          </div>
          <div>
            <input
              ref={importInputRef}
              type="file"
              accept=".enex,.xml,.ENEX,application/xml,text/xml,*/*"
              multiple
              className="hidden"
              onChange={(e) => handleEvernoteImport(e.target.files)}
            />
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition-colors disabled:opacity-50 text-sm font-medium"
            >
              {importing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Import from Evernote
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto recall-scrollbar p-4 md:p-8">
          {!isReady && (
            <p className="text-sm text-white/40">Loading your notebooks…</p>
          )}

          {isReady && notebooks.length === 0 && (
            <div className="max-w-md mx-auto text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
                <Library className="w-7 h-7 text-indigo-300" />
              </div>
              <h2 className="text-lg font-semibold text-white/80 mb-2">No notebooks yet</h2>
              <p className="text-sm text-white/40 mb-2 leading-relaxed">
                Export a notebook from Evernote as <strong className="text-white/60">.enex</strong>, then
                import it here. Each import becomes a notebook in Recall.
              </p>
              <p className="text-xs text-white/25 mb-6">
                Large exports (100MB–3GB+) are supported — keep this tab open while uploading.
              </p>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
                className="text-sm px-5 py-2.5 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30"
              >
                Import your first notebook
              </button>
            </div>
          )}

          {isReady && notebooks.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
              {notebooks.map((notebook) => (
                <Link key={notebook.id} href={notesPath({ notebook: notebook.id })}>
                  <button
                    type="button"
                    className="w-full text-left p-5 rounded-2xl recall-glass-card hover:border-indigo-500/30 transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-500/20 transition-colors">
                        <BookOpen className="w-5 h-5 text-indigo-300" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold text-white/90 truncate">{notebook.name}</h3>
                        <p className="text-sm text-white/40 mt-0.5">
                          {notebook.noteCount} note{notebook.noteCount === 1 ? "" : "s"}
                        </p>
                        {notebook.source === "evernote" && (
                          <span className="inline-block mt-2 text-[10px] uppercase tracking-wider text-indigo-300/70">
                            Evernote
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
