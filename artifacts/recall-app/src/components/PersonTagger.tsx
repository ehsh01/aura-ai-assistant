import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Plus, User, X } from "lucide-react";
import { listPeople, type PersonRecord } from "@/lib/recall-api";
import { NoteTagList, parsePersonTag } from "@/components/PersonTagLink";
import { peoplePath } from "@/lib/recall-nav";

export type PersonTaggerChange = {
  tags: string[];
  personId: string | null;
  personName: string | null;
};

/** Link a primary person (FK) and show remaining non-person tags. */
export function PersonTagger({
  tags,
  personId,
  personName,
  onChange,
}: {
  tags: string[];
  personId?: string | null;
  personName?: string | null;
  onChange: (next: PersonTaggerChange) => void;
}) {
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void listPeople()
      .then((res) => setPeople(res.people))
      .catch(() => {});
  }, []);

  const otherTags = useMemo(
    () => tags.filter((t) => !parsePersonTag(t)),
    [tags],
  );

  const displayName =
    personName?.trim() ||
    tags.map((t) => parsePersonTag(t)).find(Boolean) ||
    null;

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

  const assign = (nextId: string | null, nextName: string | null) => {
    onChange({
      tags: otherTags,
      personId: nextId,
      personName: nextName,
    });
    setDraft("");
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {displayName && !open ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-200">
            <Link
              href={personId ? peoplePath({ personId }) : peoplePath()}
              className="inline-flex items-center gap-1 text-sky-200 no-underline hover:text-white"
            >
              <User size={10} />
              {displayName}
            </Link>
            <button
              type="button"
              aria-label={`Remove ${displayName}`}
              onClick={() => assign(null, null)}
              className="ml-0.5 text-sky-200/70 hover:text-white"
            >
              <X size={10} />
            </button>
          </span>
        ) : null}
        {otherTags.length > 0 && <NoteTagList tags={otherTags} limit={6} />}
        {!open ? (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              if (displayName) setDraft(displayName);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-white/45 hover:border-sky-400/40 hover:text-sky-200"
          >
            <Plus size={10} />
            {displayName ? "Change person" : "Person"}
          </button>
        ) : null}
      </div>
      {open && (
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-2.5">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const hit = suggestions[0];
                if (hit) assign(hit.id, hit.displayName);
              }
              if (e.key === "Escape") {
                setOpen(false);
                setDraft("");
              }
            }}
            placeholder="Link a person…"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white outline-none focus:border-sky-400/50"
          />
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => assign(p.id, p.displayName)}
                  className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70 hover:border-sky-400/40 hover:text-sky-100"
                >
                  {p.displayName}
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setDraft("");
              }}
              className="rounded-lg px-2 py-1 text-[11px] text-white/45 hover:text-white/70"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
