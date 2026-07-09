import { useEffect, useMemo, useState } from "react";
import { Plus, User, X } from "lucide-react";
import { listPeople, type PersonRecord } from "@/lib/recall-api";
import { NoteTagList, parsePersonTag } from "@/components/PersonTagLink";

function personTag(name: string): string {
  return `person:${name.trim()}`;
}

/** Edit person: tags on a note (or any tag list). */
export function PersonTagger({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void listPeople()
      .then((res) => setPeople(res.people))
      .catch(() => {});
  }, []);

  const personTags = useMemo(
    () => tags.filter((t) => parsePersonTag(t)),
    [tags],
  );
  const otherTags = useMemo(
    () => tags.filter((t) => !parsePersonTag(t)),
    [tags],
  );

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const linked = new Set(
      personTags.map((t) => parsePersonTag(t)?.toLowerCase()).filter(Boolean),
    );
    return people
      .filter((p) => {
        if (linked.has(p.displayName.toLowerCase())) return false;
        if (!q) return true;
        return p.displayName.toLowerCase().includes(q);
      })
      .slice(0, 8);
  }, [people, draft, personTags]);

  const addName = (name: string) => {
    const tag = personTag(name);
    if (!tag.slice("person:".length)) return;
    const lower = tag.toLowerCase();
    if (tags.some((t) => t.toLowerCase() === lower)) {
      setDraft("");
      setOpen(false);
      return;
    }
    onChange([...tags, tag]);
    setDraft("");
    setOpen(false);
  };

  const removePersonTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {personTags.map((tag) => {
          const name = parsePersonTag(tag) ?? tag;
          return (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-200"
            >
              <User size={10} />
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => removePersonTag(tag)}
                className="ml-0.5 text-sky-200/70 hover:text-white"
              >
                <X size={10} />
              </button>
            </span>
          );
        })}
        {otherTags.length > 0 && <NoteTagList tags={otherTags} limit={6} />}
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-white/45 hover:border-sky-400/40 hover:text-sky-200"
          >
            <Plus size={10} />
            Person
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
                const name = draft.trim() || suggestions[0]?.displayName;
                if (name) addName(name);
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
                  onClick={() => addName(p.displayName)}
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
                if (draft.trim()) addName(draft.trim());
                else {
                  setOpen(false);
                  setDraft("");
                }
              }}
              className="rounded-lg bg-sky-500/20 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-500/30"
            >
              {draft.trim() ? "Add" : "Done"}
            </button>
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
