import React, { useCallback, useEffect, useState } from "react";
import {
  getSubjectSpend,
  linkSubjectSpend,
  suggestSubjectSpend,
  unlinkSubjectSpend,
  type SubjectSpendResponse,
} from "@/lib/recall-api";
import { toast } from "@/hooks/use-toast";

type Props = {
  subjectType: "vehicle" | "home";
  subjectId: string;
};

export function SubjectSpendCard({ subjectType, subjectId }: Props) {
  const [spend, setSpend] = useState<SubjectSpendResponse | null>(null);
  const [suggestions, setSuggestions] = useState<
    (SubjectSpendResponse["transactions"][number] & { score: number; matchedOn: string })[]
  >([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [s, sug] = await Promise.all([
        getSubjectSpend(subjectType, subjectId),
        suggestSubjectSpend(subjectType, subjectId),
      ]);
      setSpend(s);
      setSuggestions(sug.suggestions);
    } catch (err) {
      toast({
        title: "Could not load spend",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [subjectType, subjectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading && !spend) {
    return <p className="text-sm text-white/40">Loading spend…</p>;
  }

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-white/80">Linked spend</h3>
        <p className="text-lg font-semibold text-red-300">
          {spend?.finance.formatted.spent ?? "$0.00"}
        </p>
      </div>
      <p className="text-xs text-white/40">
        Transfers and card payments excluded. Link transactions to roll up costs for this{" "}
        {subjectType}.
      </p>

      {spend && spend.transactions.length > 0 ? (
        <ul className="space-y-1.5">
          {spend.transactions.slice(0, 8).map((tx) => (
            <li
              key={tx.id}
              className="flex items-center justify-between gap-2 text-sm text-white/70"
            >
              <div className="min-w-0">
                <p className="truncate">{tx.payee}</p>
                <p className="text-xs text-white/35">{tx.date}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-red-300">{tx.amountFormatted}</span>
                <button
                  type="button"
                  className="text-xs text-white/40 hover:text-white/70"
                  onClick={() =>
                    void unlinkSubjectSpend(subjectType, subjectId, tx.id).then(reload)
                  }
                >
                  Unlink
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-white/40">No linked expenses yet.</p>
      )}

      {suggestions.length > 0 && (
        <div className="border-t border-white/10 pt-3">
          <p className="mb-2 text-xs uppercase tracking-wider text-white/35">Suggestions</p>
          <ul className="space-y-1.5">
            {suggestions.slice(0, 5).map((tx) => (
              <li
                key={tx.id}
                className="flex items-center justify-between gap-2 text-sm text-white/65"
              >
                <div className="min-w-0">
                  <p className="truncate">{tx.payee}</p>
                  <p className="text-xs text-white/35">
                    {tx.date} · matched {tx.matchedOn}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-lg bg-indigo-500/20 px-2 py-1 text-xs text-indigo-200"
                  onClick={() =>
                    void linkSubjectSpend(subjectType, subjectId, tx.id).then(reload)
                  }
                >
                  Link
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
