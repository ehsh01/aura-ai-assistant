import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { X, FileSearch, User } from "lucide-react";
import { listEntityEvidence, type EvidenceRecord } from "@/lib/recall-api";
import { peoplePath } from "@/lib/recall-nav";

type Props = {
  open: boolean;
  onClose: () => void;
  entityType: string;
  entityId: string;
  title?: string;
  fallback?: {
    text: string;
    system: string;
    occurredAt: string | null;
    url: string | null;
  };
};

function evidenceTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function EvidenceDrawer({
  open,
  onClose,
  entityType,
  entityId,
  title,
  fallback,
}: Props) {
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
          {!loading && items.length === 0 && !fallback && (
            <p className="text-white/45">No evidence linked yet for this item.</p>
          )}
          {!loading && items.length === 0 && fallback && (
            <article className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs uppercase tracking-wider text-indigo-300/80">
                Source evidence
              </p>
              <p className="mt-1 text-xs text-white/40">
                {[fallback.system, evidenceTime(fallback.occurredAt)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white/80">
                {fallback.text}
              </p>
              {fallback.url && (
                <a
                  href={fallback.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block text-xs text-indigo-300 hover:underline"
                >
                  View source
                </a>
              )}
            </article>
          )}
          {items.map((item) => {
            const meta = item.evidenceMetadata ?? {};
            const personId = typeof meta.personId === "string" ? meta.personId : null;
            const personName =
              typeof meta.personName === "string"
                ? meta.personName
                : typeof meta.person === "string"
                  ? meta.person
                  : null;
            const system =
              typeof meta.system === "string"
                ? meta.system
                : typeof meta.source === "string"
                  ? meta.source
                  : fallback?.system ?? item.entityType.replace(/_/g, " ");
            const occurredAt =
              typeof meta.occurredAt === "string"
                ? meta.occurredAt
                : typeof meta.sourceCreatedAt === "string"
                  ? meta.sourceCreatedAt
                  : item.createdAt;
            return (
            <article key={item.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs uppercase tracking-wider text-indigo-300/80">{item.claimType.replace(/_/g, " ")}</p>
              <p className="mt-1 text-xs text-white/40">
                {[system, evidenceTime(occurredAt)].filter(Boolean).join(" · ")}
              </p>
              {item.evidenceText && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-white/80">{item.evidenceText}</p>
              )}
              {personName && (
                <div className="mt-3">
                  {personId ? (
                    <Link
                      href={peoplePath({ personId })}
                      className="inline-flex items-center gap-1 rounded-md border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-200 no-underline hover:bg-sky-500/20"
                    >
                      <User size={11} />
                      {personName}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-200/80">
                      <User size={11} />
                      {personName}
                    </span>
                  )}
                </div>
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
              {typeof meta.confidence === "number" && (
                <p className="mt-2 text-xs text-white/40">
                  Confidence: {Math.round(meta.confidence * 100)}%
                </p>
              )}
            </article>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
