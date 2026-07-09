import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { User, X } from "lucide-react";
import { listPeople, type PersonRecord } from "@/lib/recall-api";
import { peoplePath } from "@/lib/recall-nav";

/** Compact assign/clear person control for a Today task. */
export function TaskPersonPicker({
  personId,
  personName,
  onChange,
}: {
  personId?: string | null;
  personName?: string | null;
  onChange: (next: { personId: string | null; personName: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!open) return;
    void listPeople()
      .then((res) => setPeople(res.people))
      .catch(() => {});
  }, [open]);

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return people
      .filter((p) => {
        if (personId && p.id === personId) return false;
        if (!q) return true;
        return p.displayName.toLowerCase().includes(q);
      })
      .slice(0, 8);
  }, [people, draft, personId]);

  if (personName && !open) {
    return (
      <span className="inline-flex items-center gap-1">
        <Link
          href={personId ? peoplePath({ personId }) : peoplePath()}
          className="flex items-center gap-1 rounded-md border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-sky-200 no-underline hover:bg-sky-500/20"
          onClick={(e) => e.stopPropagation()}
        >
          <User size={10} /> {personName}
        </Link>
        <button
          type="button"
          title="Change person"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
            setDraft(personName);
          }}
          className="text-[10px] text-white/35 hover:text-white/60"
        >
          edit
        </button>
        <button
          type="button"
          title="Clear person"
          aria-label="Clear person"
          onClick={(e) => {
            e.stopPropagation();
            onChange({ personId: null, personName: null });
          }}
          className="text-white/30 hover:text-white/60"
        >
          <X size={10} />
        </button>
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="flex items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 text-[11px] text-white/35 hover:border-sky-400/40 hover:text-sky-200"
      >
        <User size={10} /> Person
      </button>
    );
  }

  return (
    <div
      className="relative z-10 min-w-[160px] rounded-lg border border-sky-500/25 bg-[#12121a] p-2 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setDraft("");
          }
          if (e.key === "Enter" && suggestions[0]) {
            e.preventDefault();
            onChange({
              personId: suggestions[0].id,
              personName: suggestions[0].displayName,
            });
            setOpen(false);
            setDraft("");
          }
        }}
        placeholder="Find person…"
        className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-white outline-none focus:border-sky-400/50"
      />
      <div className="mt-1.5 max-h-36 space-y-0.5 overflow-y-auto">
        {suggestions.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              onChange({ personId: p.id, personName: p.displayName });
              setOpen(false);
              setDraft("");
            }}
            className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-white/70 hover:bg-sky-500/15 hover:text-sky-100"
          >
            {p.displayName}
          </button>
        ))}
        {suggestions.length === 0 && (
          <p className="px-2 py-1 text-[11px] text-white/35">No matches</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setDraft("");
        }}
        className="mt-1 text-[11px] text-white/40 hover:text-white/70"
      >
        Cancel
      </button>
    </div>
  );
}
