import React, { useEffect, useState } from "react";
import { X, FileSearch } from "lucide-react";
import { listEntityEvidence, type EvidenceRecord } from "@/lib/recall-api";

type Props = {
  open: boolean;
  onClose: () => void;
  entityType: string;
  entityId: string;
  title?: string;
};

export function EvidenceDrawer({ open, onClose, entityType, entityId, title }: Props) {
  const [items, setItems] = useState<EvidenceRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void listEntityEvidence(entityType, entityId)
      .then((res) => setItems(res.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, entityType, entityId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close evidence"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#0f0f16] text-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <FileSearch size={18} className="text-indigo-300" />
            <div>
              <p className="text-xs uppercase tracking-wider text-white/40">Evidence</p>
              <h2 className="text-lg font-semibold">{title ?? "Source support"}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && <p className="text-white/40">Loading evidence…</p>}
          {!loading && items.length === 0 && (
            <p className="text-white/45">No evidence linked yet for this item.</p>
          )}
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs uppercase tracking-wider text-indigo-300/80">{item.claimType.replace(/_/g, " ")}</p>
              {item.evidenceText && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-white/80">{item.evidenceText}</p>
              )}
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block text-xs text-indigo-300 hover:underline"
                >
                  View source
                </a>
              )}
              {typeof item.evidenceMetadata?.confidence === "number" && (
                <p className="mt-2 text-xs text-white/40">
                  Confidence: {Math.round(item.evidenceMetadata.confidence * 100)}%
                </p>
              )}
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}
