export type HeuristicTagInput = {
  url?: string | null;
  mimeType?: string | null;
  evernoteTags?: string[];
  notebook?: string | null;
  date?: Date;
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100);
}

function add(tags: Set<string>, value: string | null | undefined): void {
  if (!value) return;
  const normalized = normalize(value);
  if (normalized) tags.add(normalized);
}

/** Internal search facets are not user-authored tags and must stay out of UI/graph. */
export function isVisibleItemTag(value: string): boolean {
  const normalized = normalize(value);
  return (
    !normalized.startsWith("notebook:") && !/^year:\d{4}$/.test(normalized)
  );
}

/** Evernote display tags contain only names returned by Evernote, not Recall facets. */
export function evernoteDisplayTags(values: string[]): string[] {
  const tags = new Set<string>();
  for (const value of values) {
    if (isVisibleItemTag(value)) add(tags, value);
  }
  return [...tags];
}

/** Deterministic, free labels only. No model or embedding call is made here. */
export function heuristicItemTags(input: HeuristicTagInput): string[] {
  const tags = new Set<string>();

  if (input.url) {
    try {
      const domain = new URL(input.url).hostname
        .toLowerCase()
        .replace(/^www\./, "");
      add(tags, domain);
      add(tags, `domain:${domain}`);
    } catch {
      // A malformed optional source URL should not prevent saving.
    }
  }

  if (input.mimeType) {
    const [family, subtype] = input.mimeType.toLowerCase().split("/");
    add(tags, family ? `type:${family}` : null);
    add(tags, subtype ? `format:${subtype.replace(/^x-/, "")}` : null);
  }

  for (const tag of input.evernoteTags ?? []) add(tags, tag);
  if (input.notebook) add(tags, `notebook:${input.notebook}`);

  const date = input.date ?? new Date();
  if (!Number.isNaN(date.getTime())) {
    const year = String(date.getUTCFullYear());
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    add(tags, `year:${year}`);
    add(tags, `date:${year}-${month}`);
  }

  return [...tags];
}
