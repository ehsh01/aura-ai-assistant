import { listTasksForUser } from "./tasks";
import { listNotesForUser } from "./notes";
import { listPeopleForUser } from "./people";
import { listKnowledgeForUser } from "./knowledge";
import { listDocumentsForUser } from "./documents";
import { listCapturesForUser } from "./captures";
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
};

/** Detect known people named in the question for retrieval boost. */
export function mentionedPeople(
  question: string,
  people: { id: string; displayName: string }[],
): { id: string; displayName: string }[] {
  const lower = question.toLowerCase();
  const hits: { id: string; displayName: string }[] = [];
  for (const p of people) {
    const name = p.displayName.trim();
    if (name.length < 2) continue;
    if (lower.includes(name.toLowerCase())) {
      hits.push(p);
      continue;
    }
    const first = name.split(/\s+/)[0] ?? "";
    if (
      first.length >= 3 &&
      new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(question)
    ) {
      hits.push(p);
    }
  }
  return hits;
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
  documents: 100,
  captures: 100,
  keywordShortlist: 80,
  semanticCandidates: 280,
} as const;

async function collectCorpus(
  userId: string,
): Promise<{ records: ContextRecord[]; people: { id: string; displayName: string }[] }> {
  const [tasks, notes, people, knowledge, documents, captures] = await Promise.all([
    listTasksForUser(userId),
    listNotesForUser(userId),
    listPeopleForUser(userId),
    listKnowledgeForUser(userId),
    listDocumentsForUser(userId),
    listCapturesForUser(userId, { limit: CORPUS.captures }),
  ]);

  const records: ContextRecord[] = [];

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
    records.push({
      entityType: "note",
      entityId: n.id,
      title: n.title,
      text: `${n.title}\n${(n.preview ?? n.content ?? "").slice(0, 600)}\ntags=${tags}`,
    });
  }
  for (const p of people.slice(0, CORPUS.people)) {
    records.push({
      entityType: "person",
      entityId: p.id,
      title: p.displayName,
      text: `${p.displayName} ${p.organization ?? ""} ${p.email ?? ""}`.trim(),
    });
  }
  for (const k of knowledge.slice(0, CORPUS.knowledge)) {
    records.push({
      entityType: "knowledge",
      entityId: k.id,
      title: k.title,
      text: `${k.title}\n${k.content.slice(0, 600)}\ntags=${k.tags.join(",")}`,
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
): Promise<{ records: RetrievedRecord[]; usedSemantic: boolean }> {
  const { records: corpus, people } = await collectCorpus(userId);
  if (corpus.length === 0) return { records: [], usedSemantic: false };

  const named = mentionedPeople(question, people);
  const namedIds = new Set(named.map((p) => p.id));
  const namedTokens = named.flatMap((p) => {
    const parts = p.displayName.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    return [p.displayName.toLowerCase(), ...parts];
  });

  const personBoost = (r: ContextRecord): number => {
    if (named.length === 0) return 0;
    if (r.entityType === "person" && namedIds.has(r.entityId)) return 0.35;
    const hay = `${r.title}\n${r.text}`.toLowerCase();
    for (const token of namedTokens) {
      if (hay.includes(token)) return 0.22;
    }
    return 0;
  };

  const keywordHits = corpus
    .map((r) => ({
      r,
      kw: keywordScore(question, `${r.title}\n${r.text}`) + personBoost(r),
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
      // Always include named people cards in the semantic candidate set.
      for (const r of corpus) {
        if (r.entityType === "person" && namedIds.has(r.entityId)) {
          const id = `${r.entityType}:${r.entityId}`;
          if (!shortlistIds.has(id)) {
            shortlistIds.add(id);
            candidates.push(r);
          }
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
    const boost = personBoost(r);
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

  const top = scored
    .filter((x) => x.score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r, score, method }) => toRetrieved(r, score, method));

  // If semantic threshold filtered everything, fall back to keyword hits.
  if (top.length === 0 && keywordHits.length > 0) {
    return {
      records: keywordHits
        .slice(0, limit)
        .map(({ r, kw }) => toRetrieved(r, kw, "keyword")),
      usedSemantic: false,
    };
  }

  return { records: top, usedSemantic };
}
