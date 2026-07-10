import { desc, eq } from "drizzle-orm";
import { sourceRecords } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { listTasksForUser } from "./tasks";
import { listNotesForUser } from "./notes";
import { listPeopleForUser } from "./people";
import { listKnowledgeForUser } from "./knowledge";
import { listDocumentsForUser } from "./documents";
import { listCapturesForUser } from "./captures";
import { listMemoriesForUser } from "./life-memory";
import {
  cosineSimilarity,
  embedItemsCached,
  embedQuery,
} from "./embedding-cache";

export type RetrievedRecord = {
  entityType: string;
  entityId: string;
  title: string;
  text: string;
  score: number;
  method: "keyword" | "semantic" | "hybrid";
  matchedPersonId?: string | null;
  matchedPersonName?: string | null;
};

type ContextRecord = {
  entityType: string;
  entityId: string;
  title: string;
  text: string;
  pinned?: boolean;
  /** Optional subtype for source_records (gmail_message, drive_file, …). */
  recordType?: string;
  /** ISO timestamp for recency boosts. */
  updatedAt?: string;
};

/** Permanent memories outrank ephemeral notes/captures in hybrid scoring. */
function typeBoost(entityType: string, pinned?: boolean): number {
  if (entityType === "memory") return pinned ? 0.35 : 0.22;
  if (entityType === "knowledge") return 0.08;
  if (entityType === "person") return 0.05;
  return 0;
}

/** Detect Google / connector intents so we can force-include the right source_records. */
function googleIntent(question: string): {
  email: boolean;
  drive: boolean;
  calendar: boolean;
  contacts: boolean;
} {
  const q = question.toLowerCase();
  return {
    email: /\b(email|emails|e-mail|gmail|inbox|mail|message|messages)\b/.test(q),
    drive: /\b(drive|google\s*doc|docs|spreadsheet|sheets|file|files)\b/.test(q),
    calendar: /\b(calendar|meeting|meetings|event|events|schedule|appointment)\b/.test(q),
    contacts: /\b(contact|contacts|phone\s*number|address\s*book)\b/.test(q),
  };
}

function sourceRecordMatchesIntent(
  recordType: string | undefined,
  intent: ReturnType<typeof googleIntent>,
): boolean {
  if (!recordType) return false;
  if (intent.email && recordType === "gmail_message") return true;
  if (intent.drive && recordType === "drive_file") return true;
  if (intent.calendar && recordType === "calendar_event") return true;
  if (intent.contacts && recordType === "google_contact") return true;
  return false;
}

function sourceTypeAliases(recordType: string): string {
  switch (recordType) {
    case "gmail_message":
      return "email gmail inbox mail message";
    case "drive_file":
      return "drive file google doc document";
    case "calendar_event":
      return "calendar event meeting schedule";
    case "google_contact":
      return "contact person phone email";
    default:
      return "source record";
  }
}

/** First names that collide with common English words / months. */
const AMBIGUOUS_FIRST =
  /^(May|April|June|July|August|Will|Bill|Grant|Chase|Hope|Faith|Joy|Ray|Pat|Chris|Alex|Sam|Max|Lee|Kim|Day|Week|Month|Year|Still|Need)$/i;

/** Detect known people named in the question for retrieval boost. */
export function mentionedPeople(
  question: string,
  people: { id: string; displayName: string }[],
): { id: string; displayName: string }[] {
  const lower = question.toLowerCase();
  const fullHits: { id: string; displayName: string }[] = [];
  const firstHits: { id: string; displayName: string }[] = [];

  for (const p of people) {
    const name = p.displayName.trim();
    if (name.length < 2) continue;
    if (lower.includes(name.toLowerCase())) {
      fullHits.push(p);
      continue;
    }
    const first = name.split(/\s+/)[0] ?? "";
    if (first.length < 3 || AMBIGUOUS_FIRST.test(first)) continue;
    if (
      new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(question)
    ) {
      firstHits.push(p);
    }
  }

  // Prefer full-name matches; only use first-name hits when unique.
  if (fullHits.length > 0) return fullHits;
  if (firstHits.length === 1) return firstHits;
  // Multiple first-name collisions — skip rather than boost the wrong person.
  return [];
}

function personMatchOnRecord(
  r: ContextRecord,
  named: { id: string; displayName: string }[],
): { id: string; displayName: string } | null {
  if (named.length === 0) return null;
  if (r.entityType === "person") {
    const hit = named.find((p) => p.id === r.entityId);
    return hit ?? null;
  }
  const hay = `${r.title}\n${r.text}`.toLowerCase();
  for (const p of named) {
    const full = p.displayName.toLowerCase();
    if (hay.includes(full) || hay.includes(`person:${full}`)) return p;
    const first = full.split(/\s+/)[0] ?? "";
    if (first.length >= 3 && hay.includes(first)) return p;
  }
  return null;
}

function keywordScore(question: string, text: string): number {
  const terms = question.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (terms.length === 0) return 0;
  const hay = text.toLowerCase();
  return terms.reduce((s, t) => (hay.includes(t) ? s + 1 : s), 0) / terms.length;
}

/** Soft caps — embeddings are persisted, so a larger corpus is affordable. */
const CORPUS = {
  tasks: 250,
  notes: 250,
  people: 120,
  knowledge: 120,
  memories: 200,
  documents: 100,
  captures: 100,
  sourceRecords: 400,
  keywordShortlist: 80,
  semanticCandidates: 280,
} as const;

async function collectCorpus(
  userId: string,
): Promise<{ records: ContextRecord[]; people: { id: string; displayName: string }[] }> {
  const [tasks, notes, people, knowledge, memories, documents, captures, sources] =
    await Promise.all([
      listTasksForUser(userId),
      listNotesForUser(userId),
      listPeopleForUser(userId),
      listKnowledgeForUser(userId),
      listMemoriesForUser(userId, { limit: CORPUS.memories }),
      listDocumentsForUser(userId),
      listCapturesForUser(userId, { limit: CORPUS.captures }),
      getDb()
        .select({
          id: sourceRecords.id,
          recordType: sourceRecords.recordType,
          recordTitle: sourceRecords.recordTitle,
          recordText: sourceRecords.recordText,
          updatedAt: sourceRecords.updatedAt,
        })
        .from(sourceRecords)
        .where(eq(sourceRecords.userId, userId))
        .orderBy(desc(sourceRecords.updatedAt))
        .limit(CORPUS.sourceRecords),
    ]);

  const records: ContextRecord[] = [];

  for (const m of memories.slice(0, CORPUS.memories)) {
    const cap = m.pinned ? 4000 : 1200;
    records.push({
      entityType: "memory",
      entityId: m.id,
      title: m.title,
      text: `domain=${m.domain} ${m.title}\n${m.content.slice(0, cap)}\ntags=${m.tags.join(",")}${
        m.primaryPersonId ? ` personId=${m.primaryPersonId}` : ""
      }${m.pinned ? " pinned=true" : ""}`,
      pinned: m.pinned,
    });
  }

  for (const t of tasks.slice(0, CORPUS.tasks)) {
    const personBits = [t.requesterPersonName, t.requesterPersonId]
      .filter(Boolean)
      .join(" ");
    records.push({
      entityType: "task",
      entityId: t.id,
      title: t.title,
      text: `${t.title} priority=${t.priority} due=${t.time ?? "none"} completed=${t.completed}${
        personBits ? ` person=${personBits}` : ""
      }`,
    });
  }
  for (const n of notes.slice(0, CORPUS.notes)) {
    const tags = Array.isArray(n.tags) ? n.tags.join(",") : "";
    const personBits = [n.primaryPersonName, n.primaryPersonId].filter(Boolean).join(" ");
    records.push({
      entityType: "note",
      entityId: n.id,
      title: n.title,
      text: `${n.title}\n${(n.preview ?? n.content ?? "").slice(0, 600)}\ntags=${tags}${
        personBits ? ` person=${personBits}` : ""
      }`,
    });
  }
  for (const p of people.slice(0, CORPUS.people)) {
    const fullName =
      [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || p.displayName;
    const nameBits = [
      `fullName=${fullName}`,
      `displayName=${p.displayName}`,
      p.firstName ? `firstName=${p.firstName}` : null,
      p.lastName ? `lastName=${p.lastName}` : null,
      p.organization ? `organization=${p.organization}` : null,
      p.email ? `email=${p.email}` : null,
      p.phone ? `phone=${p.phone}` : null,
      p.role ? `role=${p.role}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    records.push({
      entityType: "person",
      entityId: p.id,
      title: fullName,
      text: nameBits,
    });
  }
  for (const k of knowledge.slice(0, CORPUS.knowledge)) {
    const personBits = [k.primaryPersonName, k.primaryPersonId].filter(Boolean).join(" ");
    records.push({
      entityType: "knowledge",
      entityId: k.id,
      title: k.title,
      text: `${k.title}\n${k.content.slice(0, 600)}\ntags=${k.tags.join(",")}${
        personBits ? ` person=${personBits}` : ""
      }`,
    });
  }
  for (const d of documents.slice(0, CORPUS.documents)) {
    records.push({
      entityType: "document",
      entityId: d.id,
      title: d.fileName,
      text: `${d.fileName}\n${(d.summary ?? d.extractedText ?? "").slice(0, 600)}`,
    });
  }
  for (const c of captures) {
    records.push({
      entityType: "capture",
      entityId: c.id,
      title: c.title || "Capture",
      text: `${c.title ?? ""}\n${(c.rawText ?? "").slice(0, 500)}`,
    });
  }

  for (const s of sources) {
    const title = s.recordTitle || s.recordType || "Source record";
    const aliases = sourceTypeAliases(s.recordType);
    records.push({
      entityType: "source_record",
      entityId: s.id,
      title,
      text: `${aliases} source=${s.recordType} ${title}\n${(s.recordText ?? "").slice(0, 800)}`,
      recordType: s.recordType,
      updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : undefined,
    });
  }

  return {
    records,
    people: people.map((p) => ({ id: p.id, displayName: p.displayName })),
  };
}

/**
 * Hybrid retrieval: keyword + semantic embeddings (when available).
 * Vectors are L1 (memory) + L2 (entity_embeddings) cached by content hash.
 */
export async function retrieveRelevantRecords(
  userId: string,
  question: string,
  limit = 16,
): Promise<{
  records: RetrievedRecord[];
  usedSemantic: boolean;
  namedPeople: { id: string; displayName: string }[];
}> {
  const { records: corpus, people } = await collectCorpus(userId);
  if (corpus.length === 0) {
    return { records: [], usedSemantic: false, namedPeople: [] };
  }

  const intent = googleIntent(question);
  const wantsGoogle =
    intent.email || intent.drive || intent.calendar || intent.contacts;

  const named = mentionedPeople(question, people);
  const namedIds = new Set(named.map((p) => p.id));
  const namedTokens = named.flatMap((p) => {
    const parts = p.displayName.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    return [p.displayName.toLowerCase(), ...parts];
  });
  const personTagNeedles = named.map((p) => `person:${p.displayName.toLowerCase()}`);

  const personBoost = (r: ContextRecord): number => {
    if (named.length === 0) return 0;
    if (r.entityType === "person" && namedIds.has(r.entityId)) return 0.45;
    if (
      r.entityType === "memory" &&
      (r.text.includes("domain=family") || r.text.includes("domain=people"))
    ) {
      const hay = `${r.title}\n${r.text}`.toLowerCase();
      for (const token of namedTokens) {
        if (hay.includes(token)) return 0.4;
      }
    }
    const hay = `${r.title}\n${r.text}`.toLowerCase();
    for (const needle of personTagNeedles) {
      if (hay.includes(needle)) return 0.38;
    }
    for (const token of namedTokens) {
      if (hay.includes(token)) return 0.28;
    }
    return 0;
  };

  const googleBoost = (r: ContextRecord): number => {
    if (!wantsGoogle) return 0;
    if (r.entityType !== "source_record") return 0;
    if (!sourceRecordMatchesIntent(r.recordType, intent)) return 0;
    // Strong boost so email/drive questions surface connector data over notes.
    return 0.55;
  };

  const keywordHits = corpus
    .map((r) => ({
      r,
      kw: keywordScore(question, `${r.title}\n${r.text}`) + personBoost(r) + googleBoost(r),
    }))
    .filter((x) => x.kw > 0)
    .sort((a, b) => b.kw - a.kw);

  let usedSemantic = false;
  const semanticScores = new Map<string, number>();

  try {
    const queryVec = await embedQuery(question);
    if (queryVec) {
      // Prefer embedding the keyword shortlist + a broader sample for recall.
      const shortlistIds = new Set(
        keywordHits
          .slice(0, CORPUS.keywordShortlist)
          .map((x) => `${x.r.entityType}:${x.r.entityId}`),
      );
      const candidates: ContextRecord[] = [];
      for (const hit of keywordHits.slice(0, CORPUS.keywordShortlist)) candidates.push(hit.r);
      // Always include named people + person-tagged records in candidates.
      for (const r of corpus) {
        const id = `${r.entityType}:${r.entityId}`;
        if (shortlistIds.has(id)) continue;
        if (r.entityType === "person" && namedIds.has(r.entityId)) {
          shortlistIds.add(id);
          candidates.push(r);
          continue;
        }
        if (named.length > 0 && personBoost(r) >= 0.28) {
          shortlistIds.add(id);
          candidates.push(r);
        }
      }
      for (const r of corpus) {
        const id = `${r.entityType}:${r.entityId}`;
        if (shortlistIds.has(id)) continue;
        candidates.push(r);
        if (candidates.length >= CORPUS.semanticCandidates) break;
      }

      const vectors = await embedItemsCached(
        userId,
        candidates.map((r) => ({
          entityType: r.entityType,
          entityId: r.entityId,
          text: `${r.title}\n${r.text}`,
        })),
      );

      if (vectors) {
        usedSemantic = true;
        for (const r of candidates) {
          const vec = vectors.get(`${r.entityType}:${r.entityId}`);
          if (!vec) continue;
          semanticScores.set(`${r.entityType}:${r.entityId}`, cosineSimilarity(queryVec, vec));
        }
      }
    }
  } catch {
    // Semantic unavailable — keyword-only is fine.
  }

  const scored = corpus.map((r) => {
    const id = `${r.entityType}:${r.entityId}`;
    const kw = keywordScore(question, `${r.title}\n${r.text}`);
    const sem = semanticScores.get(id) ?? 0;
    const boost = personBoost(r) + typeBoost(r.entityType, r.pinned) + googleBoost(r);
    // Blend: semantic dominates when present; keyword still boosts exact matches.
    const score = (usedSemantic ? sem * 0.75 + kw * 0.25 : kw) + boost;
    const method: RetrievedRecord["method"] =
      usedSemantic && sem > 0 && kw > 0 ? "hybrid" : usedSemantic && sem > 0 ? "semantic" : "keyword";
    return { r, score, method };
  });

  const minScore = usedSemantic ? 0.18 : 0;
  const toRetrieved = (
    r: ContextRecord,
    score: number,
    method: RetrievedRecord["method"],
  ): RetrievedRecord => {
    const match = personMatchOnRecord(r, named);
    return {
      entityType: r.entityType,
      entityId: r.entityId,
      title: r.title,
      text: r.text,
      score,
      method,
      matchedPersonId: match?.id ?? null,
      matchedPersonName: match?.displayName ?? null,
    };
  };

  let top = scored
    .filter((x) => x.score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r, score, method }) => toRetrieved(r, score, method));

  // Email / Drive / Calendar questions: always inject the most recent matching
  // source_records so "last emails" works even when keyword/semantic miss.
  if (wantsGoogle) {
    const already = new Set(top.map((r) => r.entityId));
    const recentMatches = corpus
      .filter(
        (r) =>
          r.entityType === "source_record" &&
          sourceRecordMatchesIntent(r.recordType, intent),
      )
      .slice(0, Math.min(8, limit));
    const injected: RetrievedRecord[] = [];
    for (const r of recentMatches) {
      if (already.has(r.entityId)) continue;
      injected.push(toRetrieved(r, 0.9, "keyword"));
      already.add(r.entityId);
    }
    if (injected.length > 0) {
      top = [...injected, ...top].slice(0, limit);
    }
  }

  // If semantic threshold filtered everything, fall back to keyword hits.
  if (top.length === 0 && keywordHits.length > 0) {
    return {
      records: keywordHits
        .slice(0, limit)
        .map(({ r, kw }) => toRetrieved(r, kw, "keyword")),
      usedSemantic: false,
      namedPeople: named,
    };
  }

  return { records: top, usedSemantic, namedPeople: named };
}
