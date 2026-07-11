import { desc, eq, sql } from "drizzle-orm";
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
import { FAMILY_RELATION_INTENT } from "./query-utils";

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

const QUESTION_STOP =
  /^(the|and|for|from|with|about|what|when|where|who|how|did|does|have|has|was|were|are|any|last|recent|latest|email|emails|mail|message|messages|gmail|inbox|my|me|a|an|of|to|in|on|is|it|this|that|please|show|find|get|tell|name)$/i;

/** Family/relationship nouns we boost against Life Memory + people.role/notes. */
const FAMILY_RELATION_TERMS = [
  "wife",
  "husband",
  "spouse",
  "son",
  "daughter",
  "sister",
  "brother",
  "mom",
  "mother",
  "dad",
  "father",
  "nephew",
  "niece",
  "aunt",
  "uncle",
  "cousin",
  "kids",
  "children",
  "family",
  "boyfriend",
  "girlfriend",
  "grandson",
  "granddaughter",
  "grandchild",
  "grandchildren",
  "in-law",
  "inlaw",
] as const;

/** Relation words present in the question (handles "wife's", "sons", etc.). */
export function relationTermsInQuestion(question: string): string[] {
  const q = question.toLowerCase();
  return FAMILY_RELATION_TERMS.filter((term) => {
    const re = new RegExp(`\\b${term}(?:['']s|s)?\\b`, "i");
    return re.test(q);
  });
}

/** Name-like tokens from the question (e.g. "sandra" from "emails from Sandra"). */
function questionNameTokens(question: string): string[] {
  const tokens = question
    .toLowerCase()
    .split(/[^a-z0-9@._+-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !QUESTION_STOP.test(t));
  return [...new Set(tokens)];
}

/** Collapse repeated letters so "sandrra" ≈ "sandra". */
function collapseRepeats(s: string): string {
  return s.toLowerCase().replace(/(.)\1+/g, "$1");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = new Array<number>(cols);
  for (let j = 0; j < cols; j++) dp[j] = j;
  for (let i = 1; i < rows; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j < cols; j++) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** Fuzzy name equality for typos (sandrra/sandra, kayla/khaila). */
export function namesFuzzyMatch(a: string, b: string): boolean {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  if (collapseRepeats(x) === collapseRepeats(y)) return true;
  const maxLen = Math.max(x.length, y.length);
  if (maxLen >= 4 && levenshtein(x, y) <= 1) return true;
  // Kayla/Khaila (distance 2) and similar near-miss spellings.
  if (maxLen >= 5 && levenshtein(x, y) <= 2) return true;
  if (maxLen >= 8 && levenshtein(x, y) <= 3) return true;
  return false;
}

/** True if any word in hay fuzzy-matches needle (e.g. kayla ≈ khaila in a memory). */
export function textFuzzyHasName(hay: string, needle: string): boolean {
  const n = needle.toLowerCase().trim();
  if (n.length < 3) return false;
  const lower = hay.toLowerCase();
  if (lower.includes(n)) return true;
  for (const word of lower.split(/[^a-z0-9]+/)) {
    if (word.length >= 3 && namesFuzzyMatch(word, n)) return true;
  }
  return false;
}

/** Parse Gmail "From:" line into display name + email. */
export function parseGmailFrom(text: string): { name: string; email: string } | null {
  const line = text.match(/From:\s*(.+)/i)?.[1]?.trim();
  if (!line) return null;
  const angle = line.match(/^(.*?)\s*<([^>]+)>/);
  if (angle) {
    return {
      name: angle[1]!.replace(/^["']|["']$/g, "").trim(),
      email: angle[2]!.trim().toLowerCase(),
    };
  }
  if (line.includes("@")) {
    return { name: "", email: line.toLowerCase() };
  }
  return { name: line, email: "" };
}

type PersonRef = {
  id: string;
  displayName: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  notes?: string | null;
};

/** People whose role/notes mention a relation from the question (e.g. role=wife). */
export function peopleMatchingRelation(
  question: string,
  people: PersonRef[],
): PersonRef[] {
  const relations = relationTermsInQuestion(question);
  if (relations.length === 0) return [];
  const hits: PersonRef[] = [];
  for (const p of people) {
    const hay = `${p.role ?? ""} ${p.notes ?? ""}`.toLowerCase();
    if (!hay.trim()) continue;
    if (relations.some((rel) => hay.includes(rel))) hits.push(p);
  }
  return hits;
}

/** How strongly a gmail record's sender matches the question / known people. */
function gmailSenderMatchScore(
  _question: string,
  r: ContextRecord,
  named: PersonRef[],
  nameTokens: string[],
): number {
  if (r.entityType !== "source_record" || r.recordType !== "gmail_message") return 0;

  const from = parseGmailFrom(r.text);
  if (!from) return 0;
  const fromName = from.name.toLowerCase();
  const fromEmail = from.email.toLowerCase();
  const fromLocal = fromEmail.split("@")[0] ?? "";
  const fromParts = fromName.split(/\s+/).filter(Boolean);

  let score = 0;

  for (const p of named) {
    const needles = [
      p.displayName,
      p.firstName,
      p.lastName,
      p.email,
      [p.firstName, p.lastName].filter(Boolean).join(" "),
    ]
      .filter((x): x is string => Boolean(x && String(x).trim().length >= 2))
      .map((x) => String(x).toLowerCase());
    for (const n of needles) {
      if (n.includes("@") && (fromEmail === n || namesFuzzyMatch(fromEmail, n))) {
        score = Math.max(score, 1);
      } else if (
        namesFuzzyMatch(fromName, n) ||
        fromParts.some((part) => namesFuzzyMatch(part, n)) ||
        namesFuzzyMatch(fromLocal, n) ||
        fromEmail.includes(n)
      ) {
        score = Math.max(score, n.length >= 4 ? 0.95 : 0.85);
      }
    }
  }

  for (const token of nameTokens) {
    if (token.includes("@") && (fromEmail === token || fromEmail.includes(token))) {
      score = Math.max(score, 1);
    } else if (
      fromParts.some((part) => namesFuzzyMatch(part, token)) ||
      namesFuzzyMatch(fromName, token) ||
      namesFuzzyMatch(fromLocal, token)
    ) {
      score = Math.max(score, token.length >= 4 ? 0.95 : 0.85);
    }
  }

  return score;
}

/** First names that collide with common English words / months. */
const AMBIGUOUS_FIRST =
  /^(May|April|June|July|August|Will|Bill|Grant|Chase|Hope|Faith|Joy|Ray|Pat|Chris|Alex|Sam|Max|Lee|Kim|Day|Week|Month|Year|Still|Need)$/i;

/** Detect known people named in the question for retrieval boost. */
export function mentionedPeople(
  question: string,
  people: PersonRef[],
): PersonRef[] {
  const lower = question.toLowerCase();
  const fullHits: PersonRef[] = [];
  const firstHits: PersonRef[] = [];
  const qTokens = questionNameTokens(question);

  for (const p of people) {
    const name = p.displayName.trim();
    if (name.length < 2) continue;

    // Exact full-name or email substring — strongest signal.
    if (lower.includes(name.toLowerCase())) {
      fullHits.push(p);
      continue;
    }
    if (p.email && lower.includes(p.email.toLowerCase())) {
      fullHits.push(p);
      continue;
    }

    // Fuzzy full display name (typos like "sandrra hernandez").
    if (qTokens.length > 0 && namesFuzzyMatch(qTokens.join(" "), name.toLowerCase())) {
      fullHits.push(p);
      continue;
    }
    // All significant name parts fuzzy-present in the question.
    const nameParts = name
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !AMBIGUOUS_FIRST.test(t));
    if (
      nameParts.length >= 2 &&
      nameParts.every((part) => qTokens.some((t) => namesFuzzyMatch(t, part)))
    ) {
      fullHits.push(p);
      continue;
    }

    const first = (p.firstName?.trim() || name.split(/\s+/)[0] || "");
    if (first.length < 3 || AMBIGUOUS_FIRST.test(first)) continue;
    if (
      new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(question) ||
      qTokens.some((t) => namesFuzzyMatch(t, first))
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

/** Strip possessives/punctuation so "wife's" matches "wife". */
export function normalizeKeywordToken(t: string): string {
  return t
    .toLowerCase()
    .replace(/^[^\w@]+|[^\w@]+$/g, "")
    .replace(/['']s$/i, "")
    .replace(/['']/g, "");
}

export function keywordScore(question: string, text: string): number {
  const terms = question
    .toLowerCase()
    .split(/\s+/)
    .map(normalizeKeywordToken)
    .filter((t) => t.length > 2);
  if (terms.length === 0) return 0;
  const hay = text.toLowerCase();
  return terms.reduce((s, t) => (hay.includes(t) ? s + 1 : s), 0) / terms.length;
}

function isFamilyDomainMemory(r: ContextRecord): boolean {
  return (
    r.entityType === "memory" &&
    (r.text.includes("domain=family") || r.text.includes("domain=people"))
  );
}

function relationMatchScore(r: ContextRecord, relations: string[]): number {
  if (relations.length === 0) return 0;
  const hay = `${r.title}\n${r.text}`.toLowerCase();
  const words = hay.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  let hits = 0;
  for (const rel of relations) {
    if (hay.includes(rel)) {
      hits += 1;
      continue;
    }
    // Tolerate typos like "boyfrind" ≈ "boyfriend".
    if (words.some((w) => namesFuzzyMatch(w, rel))) hits += 1;
  }
  return hits;
}

/** Name tokens from the question that aren't relation/stop words (e.g. Kayla). */
function questionPersonNameTokens(question: string): string[] {
  const relations = new Set(relationTermsInQuestion(question));
  return questionNameTokens(question).filter(
    (t) =>
      !relations.has(t) &&
      !/^(name|names|named|know|tell|what|who|about|from|with)$/i.test(t),
  );
}

function memoryNameMatchScore(r: ContextRecord, nameTokens: string[]): number {
  if (nameTokens.length === 0 || r.entityType !== "memory") return 0;
  const hay = `${r.title}\n${r.text}`;
  let hits = 0;
  for (const token of nameTokens) {
    if (textFuzzyHasName(hay, token)) hits += 1;
  }
  return hits;
}

/** Family facts often land in domain=other — match by relation words in the text too. */
function isFamilyRelevantMemory(r: ContextRecord, relations: string[]): boolean {
  if (r.entityType !== "memory") return false;
  if (isFamilyDomainMemory(r)) return true;
  return relationMatchScore(r, relations) > 0;
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
): Promise<{ records: ContextRecord[]; people: PersonRef[] }> {
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
          sourceCreatedAt: sourceRecords.sourceCreatedAt,
        })
        .from(sourceRecords)
        .where(eq(sourceRecords.userId, userId))
        .orderBy(
          desc(sql`coalesce(${sourceRecords.sourceCreatedAt}, ${sourceRecords.updatedAt})`),
        )
        .limit(CORPUS.sourceRecords),
    ]);

  const records: ContextRecord[] = [];
  const personById = new Map(people.map((p) => [p.id, p] as const));

  for (const m of memories.slice(0, CORPUS.memories)) {
    const cap = m.pinned ? 4000 : 1200;
    const linked = m.primaryPersonId ? personById.get(m.primaryPersonId) : undefined;
    const personName =
      linked?.displayName ??
      ([linked?.firstName, linked?.lastName].filter(Boolean).join(" ").trim() || null);
    records.push({
      entityType: "memory",
      entityId: m.id,
      title: m.title,
      text: `domain=${m.domain} ${m.title}\n${m.content.slice(0, cap)}\ntags=${m.tags.join(",")}${
        m.primaryPersonId ? ` personId=${m.primaryPersonId}` : ""
      }${personName ? ` person=${personName}` : ""}${m.pinned ? " pinned=true" : ""}`,
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
      p.notes ? `notes=${p.notes.slice(0, 400)}` : null,
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
    const from = s.recordType === "gmail_message" ? parseGmailFrom(s.recordText ?? "") : null;
    const senderBits = from
      ? ` sender_name=${from.name} sender_email=${from.email}`
      : "";
    records.push({
      entityType: "source_record",
      entityId: s.id,
      title,
      text: `${aliases} source=${s.recordType} ${title}${senderBits}\n${(s.recordText ?? "").slice(0, 800)}`,
      recordType: s.recordType,
      updatedAt: s.sourceCreatedAt
        ? new Date(s.sourceCreatedAt).toISOString()
        : s.updatedAt
          ? new Date(s.updatedAt).toISOString()
          : undefined,
    });
  }

  return {
    records,
    people: people.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      email: p.email ?? null,
      firstName: p.firstName ?? null,
      lastName: p.lastName ?? null,
      role: p.role ?? null,
      notes: p.notes ?? null,
    })),
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
  const wantsFamily = FAMILY_RELATION_INTENT.test(question);
  const relations = relationTermsInQuestion(question);
  const nameTokens = questionNameTokens(question);
  const personNameTokens = questionPersonNameTokens(question);
  const namedByMention = mentionedPeople(question, people);
  const namedByRelation = peopleMatchingRelation(question, people);
  const namedMap = new Map<string, PersonRef>();
  for (const p of [...namedByMention, ...namedByRelation]) namedMap.set(p.id, p);
  const named = [...namedMap.values()];
  const namedIds = new Set(named.map((p) => p.id));
  const namedTokens = named.flatMap((p) => {
    const parts = p.displayName.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    return [p.displayName.toLowerCase(), ...parts];
  });
  const personTagNeedles = named.map((p) => `person:${p.displayName.toLowerCase()}`);

  // If the question names someone who appears as a Gmail sender, treat as email intent.
  const senderMatchedMail = corpus.filter(
    (r) => gmailSenderMatchScore(question, r, named, nameTokens) >= 0.8,
  );
  // Family/name questions must not pull random Gmail senders (e.g. "Gina" therapy portal).
  const wantsGoogle =
    intent.email ||
    intent.drive ||
    intent.calendar ||
    intent.contacts ||
    (!wantsFamily && senderMatchedMail.length > 0);

  const personBoost = (r: ContextRecord): number => {
    // Family memories: boost even when no People row is named (facts live in Memory).
    if (wantsFamily && isFamilyRelevantMemory(r, relations)) {
      const relHits = relationMatchScore(r, relations);
      const nameHits = memoryNameMatchScore(r, personNameTokens);
      if (nameHits > 0 && relHits > 0) return 0.75;
      if (nameHits > 0) return 0.65;
      if (relHits > 0) return 0.55 + Math.min(relHits, 2) * 0.05;
      return isFamilyDomainMemory(r) ? 0.35 : 0;
    }
    if (r.entityType === "memory" && memoryNameMatchScore(r, personNameTokens) > 0) {
      return 0.5;
    }
    if (named.length === 0) return 0;
    if (r.entityType === "person" && namedIds.has(r.entityId)) return 0.45;
    if (isFamilyDomainMemory(r) || relationMatchScore(r, relations) > 0) {
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
    const sender = gmailSenderMatchScore(question, r, named, nameTokens);
    if (sender >= 0.8) return 0.7 + sender * 0.25; // prefer sender-matched mail
    if (!wantsGoogle) return 0;
    if (r.entityType !== "source_record") return 0;
    if (!sourceRecordMatchesIntent(r.recordType, intent) && senderMatchedMail.length === 0) {
      return 0;
    }
    if (r.recordType === "gmail_message" && (intent.email || senderMatchedMail.length > 0)) {
      return 0.55;
    }
    if (sourceRecordMatchesIntent(r.recordType, intent)) return 0.55;
    return 0;
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
      // Always include named people + person-tagged + family memories + sender-matched gmail.
      for (const r of corpus) {
        const id = `${r.entityType}:${r.entityId}`;
        if (shortlistIds.has(id)) continue;
        if (r.entityType === "person" && namedIds.has(r.entityId)) {
          shortlistIds.add(id);
          candidates.push(r);
          continue;
        }
        if (wantsFamily && isFamilyRelevantMemory(r, relations)) {
          shortlistIds.add(id);
          candidates.push(r);
          continue;
        }
        if (named.length > 0 && personBoost(r) >= 0.28) {
          shortlistIds.add(id);
          candidates.push(r);
          continue;
        }
        if (gmailSenderMatchScore(question, r, named, nameTokens) >= 0.8) {
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

  // Prefer emails whose From name/address matches the asked-about person.
  if (wantsGoogle || senderMatchedMail.length > 0) {
    const already = new Set(top.map((r) => r.entityId));
    const injected: RetrievedRecord[] = [];

    const bySender = [...senderMatchedMail].sort(
      (a, b) =>
        gmailSenderMatchScore(question, b, named, nameTokens) -
        gmailSenderMatchScore(question, a, named, nameTokens),
    );
    for (const r of bySender.slice(0, Math.min(8, limit))) {
      if (already.has(r.entityId)) continue;
      injected.push(
        toRetrieved(r, 1.1 + gmailSenderMatchScore(question, r, named, nameTokens), "keyword"),
      );
      already.add(r.entityId);
    }

    if (intent.email && injected.length < 4) {
      const recentMatches = corpus
        .filter(
          (r) =>
            r.entityType === "source_record" &&
            sourceRecordMatchesIntent(r.recordType, intent),
        )
        .slice(0, Math.min(8, limit));
      for (const r of recentMatches) {
        if (already.has(r.entityId)) continue;
        injected.push(toRetrieved(r, 0.9, "keyword"));
        already.add(r.entityId);
        if (injected.length >= 8) break;
      }
    }

    if (injected.length > 0) {
      top = [...injected, ...top].slice(0, limit);
    }
  }

  // Force-include Life Memories for relationship questions (any domain if text matches).
  if (wantsFamily) {
    const already = new Set(top.map((r) => r.entityId));
    const familyMemories = corpus
      .filter((r) => r.entityType === "memory")
      .map((r) => ({
        r,
        relScore: relationMatchScore(r, relations),
        nameScore: memoryNameMatchScore(r, personNameTokens),
      }))
      .filter(
        (x) =>
          x.relScore > 0 ||
          x.nameScore > 0 ||
          isFamilyDomainMemory(x.r),
      )
      .sort((a, b) => {
        const sa = a.relScore * 2 + a.nameScore * 3;
        const sb = b.relScore * 2 + b.nameScore * 3;
        if (sb !== sa) return sb - sa;
        // Prefer tighter relation hits over dumping every family note first.
        if (a.relScore + a.nameScore === 0 && b.relScore + b.nameScore === 0) {
          return b.r.text.length - a.r.text.length;
        }
        return 0;
      });

    const injected: RetrievedRecord[] = [];
    for (const { r, relScore, nameScore } of familyMemories.slice(0, Math.min(10, limit))) {
      if (already.has(r.entityId)) continue;
      const rank = 1.0 + relScore * 0.12 + nameScore * 0.2;
      injected.push(toRetrieved(r, rank, "keyword"));
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
