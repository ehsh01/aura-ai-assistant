import React, { useEffect, useState } from "react";
import { getSubjectTimeline, type SubjectTimelineItem } from "@/lib/recall-api";
import { Link } from "wouter";

type Props = {
  subjectType: "project" | "vehicle" | "home";
  subjectId: string;
};

export function SubjectTimelineCard({ subjectType, subjectId }: Props) {
  const [items, setItems] = useState<SubjectTimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void getSubjectTimeline(subjectType, subjectId)
      .then((r) => setItems(r.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [subjectType, subjectId]);

  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-4">
      <h3 className="text-sm font-semibold text-white/80">Timeline</h3>
      {loading ? (
        <p className="text-sm text-white/40">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-white/40">No linked activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 12).map((item) => (
            <li key={`${item.entityType}:${item.entityId}:${item.at}`}>
              <Link href={item.href} className="block text-sm text-white/75 hover:text-white">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{item.title}</span>
                  <span className="shrink-0 text-xs text-white/35">
                    {item.at.slice(0, 10)}
                  </span>
                </div>
                <p className="text-xs text-white/40">
                  {item.provenance}
                  {item.summary ? ` · ${item.summary}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
