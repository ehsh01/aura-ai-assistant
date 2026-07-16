/**
 * Canonical embedding input strings.
 * Warm-on-write and Ask semantic retrieval MUST use the same text so
 * content_hash cache hits and we do not re-pay OpenAI for identical vectors.
 */

export type MemoryEmbedSource = {
  domain: string;
  title: string;
  content: string;
  tags?: string[] | null;
  primaryPersonId?: string | null;
  personName?: string | null;
  pinned?: boolean;
  /** Prefer digest for embed when present (Phase 2). */
  summary?: string | null;
};

export type PersonEmbedSource = {
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  organization?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  notes?: string | null;
};

export type ContextEmbedSource = {
  entityType: string;
  title: string;
  text: string;
  digest?: string | null;
};

/** Life Memory embed/warm string — matches Ask corpus build. */
export function memoryEmbeddingText(m: MemoryEmbedSource): string {
  const cap = m.pinned ? 4_000 : 1_200;
  const body = (m.summary?.trim() || m.content).slice(0, cap);
  return `domain=${m.domain} ${m.title}\n${body}\ntags=${(m.tags ?? []).join(",")}${
    m.primaryPersonId ? ` personId=${m.primaryPersonId}` : ""
  }${m.personName ? ` person=${m.personName}` : ""}${m.pinned ? " pinned=true" : ""}`;
}

/** Person embed/warm string — matches Ask corpus build. */
export function personEmbeddingText(p: PersonEmbedSource): string {
  const fullName =
    [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || p.displayName;
  return [
    `fullName=${fullName}`,
    `displayName=${p.displayName}`,
    p.firstName ? `firstName=${p.firstName}` : null,
    p.lastName ? `lastName=${p.lastName}` : null,
    p.organization ? `organization=${p.organization}` : null,
    p.email ? `email=${p.email}` : null,
    p.phone ? `phone=${p.phone}` : null,
    p.role ? `role=${p.role}` : null,
    p.notes ? `notes=${p.notes.slice(0, 400)}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Text sent to embedItemsCached for a ranked context row.
 * Do NOT prefix title when `text` already includes it (notes via noteRetrievalText).
 * Prefer digest when present for compact, stable vectors.
 */
export function embeddingTextForContextRecord(r: ContextEmbedSource): string {
  const digest = r.digest?.trim();
  if (digest) {
    return `${r.title}\n${digest}`.slice(0, 800);
  }
  return r.text;
}
