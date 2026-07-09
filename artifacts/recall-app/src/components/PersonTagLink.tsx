import { useEffect, useState } from "react";
import { Link } from "wouter";
import { User } from "lucide-react";
import { listPeople, type PersonRecord } from "@/lib/recall-api";
import { peoplePath } from "@/lib/recall-nav";

const PERSON_TAG = /^person:(.+)$/i;

let peopleCache: PersonRecord[] | null = null;
let peoplePromise: Promise<PersonRecord[]> | null = null;

function loadPeople(): Promise<PersonRecord[]> {
  if (peopleCache) return Promise.resolve(peopleCache);
  if (!peoplePromise) {
    peoplePromise = listPeople()
      .then((res) => {
        peopleCache = res.people;
        return res.people;
      })
      .catch(() => {
        peoplePromise = null;
        return [];
      });
  }
  return peoplePromise;
}

/** Call after creating/updating people so tag links resolve fresh names. */
export function invalidatePeopleCache(): void {
  peopleCache = null;
  peoplePromise = null;
}

export function parsePersonTag(tag: string): string | null {
  const m = tag.match(PERSON_TAG);
  return m?.[1]?.trim() || null;
}

/** Renders a person:Name tag as a People deep-link when possible. */
export function PersonTagLink({
  tag,
  className = "",
  /** When set, click filters/handles locally instead of navigating to People. */
  onPersonClick,
}: {
  tag: string;
  className?: string;
  onPersonClick?: (name: string) => void;
}) {
  const name = parsePersonTag(tag);
  const [personId, setPersonId] = useState<string | null>(null);

  useEffect(() => {
    if (!name || onPersonClick) return;
    let cancelled = false;
    void loadPeople().then((people) => {
      if (cancelled) return;
      const lower = name.toLowerCase();
      const hit = people.find(
        (p) =>
          p.displayName.toLowerCase() === lower ||
          p.displayName.toLowerCase().includes(lower) ||
          lower.includes(p.displayName.toLowerCase()),
      );
      setPersonId(hit?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [name, onPersonClick]);

  if (!name) {
    return (
      <span className={className || "text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50"}>
        {tag}
      </span>
    );
  }

  const chipClass =
    className ||
    "inline-flex items-center gap-1 rounded-md border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-200 no-underline hover:bg-sky-500/20";

  if (onPersonClick) {
    return (
      <button
        type="button"
        className={chipClass}
        onClick={(e) => {
          e.stopPropagation();
          onPersonClick(name);
        }}
      >
        <User size={10} />
        {name}
      </button>
    );
  }

  return (
    <Link
      href={personId ? peoplePath({ personId }) : peoplePath()}
      className={chipClass}
      onClick={(e) => e.stopPropagation()}
    >
      <User size={10} />
      {name}
    </Link>
  );
}

export function NoteTagList({
  tags,
  limit = 4,
  onPersonClick,
}: {
  tags: string[];
  limit?: number;
  onPersonClick?: (name: string) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.slice(0, limit).map((tag) =>
        parsePersonTag(tag) ? (
          <PersonTagLink key={tag} tag={tag} onPersonClick={onPersonClick} />
        ) : (
          <span
            key={tag}
            className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50 whitespace-nowrap"
          >
            {tag}
          </span>
        ),
      )}
    </div>
  );
}
