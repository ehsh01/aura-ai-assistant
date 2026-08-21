import { and, desc, eq, sql } from "drizzle-orm";
import { connectors, sourceRecords } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { listTasksForUser } from "./tasks";
import { listNotesForUser, searchNotesForUser } from "./notes";
import { listPeopleForUser } from "./people";
import { listVehiclesForUser } from "./vehicles";
import { listHomesForUser } from "./homes";
import { listOrganizationsForUser } from "./organizations";
import { listInvoicesForUser } from "./invoices";
import { listWarrantiesForUser } from "./warranties";
import { listProjectsForRetrieval } from "./projects";
import { listPersonNameAliases, peopleWithAliasNames } from "./user-corrections";
import {
  linkedEntityKeySet,
} from "./entity-links";
import {
  loadLinkedContextRecordsForPeople,
} from "./shared-context";
import { listKnowledgeForUser } from "./knowledge";
import { listDocumentsForUser } from "./documents";
import { listCapturesForUser } from "./captures";
import { listAttentionForToday } from "./attention";
import { listMemoriesForUser } from "./life-memory";
import { noteRetrievalText } from "./note-retrieval";
import { keywordScore } from "./keyword-match";
import {
  cosineSimilarity,
  embedItemsCached,
  embedQuery,
  getEmbeddingCacheMetrics,
  rankEntitiesByPgvector,
} from "./embedding-cache";
import {
  embeddingTextForContextRecord,
  memoryEmbeddingText,
  personEmbeddingText,
} from "./embedding-text";
import { FAMILY_RELATION_INTENT, formatInstantForUser } from "./query-utils";
import { logger } from "../lib/logger";

export {
  extractVinCandidates,
  keywordScore,
  normalizeKeywordToken,
} from "./keyword-match";

export type RetrievedRecord = {
  entityType: string;
  entityId: string;
  title: string;
  text: string;
  score: number;
  method: "keyword" | "semantic" | "hybrid";
  matchedPersonId?: string | null;
  matchedPersonName?: string | null;
  /** Source subtype when entityType is source_record. */
  recordType?: string;
  /** ISO source timestamp (email sent / file modified / etc.). */
  updatedAt?: string;
  digest?: string | null;
  pinned?: boolean;
  expandPreferred?: boolean;
};

type ContextRecord = {
  entityType: string;
  entityId: string;
  title: string;
  text: string;
  /** Compact digest for embed/prompt when present (Phase 2). */
  digest?: string | null;
  pinned?: boolean;
  /** Optional subtype for source_records (gmail_message, drive_file, …). */
  recordType?: string;
  /** Connected Google mailbox this record came from (lowercase). */
  mailbox?: string | null;
  /** ISO timestamp for recency boosts. */
  updatedAt?: string;
  /** Force full-text expansion into the answer prompt. */
  expandPreferred?: boolean;
};

/** Permanent memories outrank ephemeral notes/captures in hybrid scoring. */
function typeBoost(entityType: string, pinned?: boolean): number {
  if (entityType === "memory") return pinned ? 0.35 : 0.22;
  if (entityType === "note") return 0.1;
  if (entityType === "knowledge") return 0.08;
  if (entityType === "person") return 0.05;
  if (entityType === "vehicle" || entityType === "warranty" || entityType === "home") return 0.12;
  if (entityType === "organization" || entityType === "invoice") return 0.1;
  if (entityType === "attention_item") return 0.15;
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
    case "homey_device":
      return "homey smart home device light lock sensor thermostat";
    case "homey_flow":
      return "homey smart home flow automation scene";
    case "homey_alert":
      return "homey smart home alert notification emergency door leak smoke";
    case "flipperforce_project":
      return "flipperforce rehab property flip wholesale project address";
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
  attention: 80,
  vehicles: 40,
  homes: 20,
  warranties: 40,
  organizations: 40,
  invoices: 40,
  projects: 40,
  /** Per connected Google mailbox — keeps ehernandez2 + REI + others searchable. */
  gmailPerMailbox: 150,
  contactsTotal: 40,
  driveTotal: 40,
  calendarTotal: 40,
  keywordShortlist: 80,
  semanticCandidates: 280,
} as const;

function connectorGoogleEmail(settings: unknown): string | null {
  if (!settings || typeof settings !== "object") return null;
  const email = (settings as Record<string, unknown>).googleEmail;
  return typeof email === "string" ? email.trim().toLowerCase() : null;
}

/** If the question names a connected mailbox (full or local-part), return it. */
export function extractMailboxHint(question: string, mailboxes: string[]): string | null {
  const q = question.toLowerCase();
  for (const mailbox of mailboxes) {
    const m = mailbox.toLowerCase();
    if (q.includes(m)) return m;
    const local = m.split("@")[0] ?? "";
    if (local.length >= 4 && q.includes(local)) return m;
  }
  return null;
}

type SourceRow = {
  id: string;
  recordType: string;
  recordTitle: string | null;
  recordText: string | null;
  updatedAt: Date | null;
  sourceCreatedAt: Date | null;
  mailbox: string | null;
  metadata?: Record<string, unknown> | null;
};

function sourceRowToContext(s: SourceRow): ContextRecord {
  const title = s.recordTitle || s.recordType || "Source record";
  const aliases = sourceTypeAliases(s.recordType);
  const from = s.recordType === "gmail_message" ? parseGmailFrom(s.recordText ?? "") : null;
  const senderBits = from
    ? ` sender_name=${from.name} sender_email=${from.email}`
    : "";
  const mailboxBit = s.mailbox ? ` mailbox=${s.mailbox}` : "";
  const sourceIso = s.sourceCreatedAt
    ? new Date(s.sourceCreatedAt).toISOString()
    : s.updatedAt
      ? new Date(s.updatedAt).toISOString()
      : undefined;
  const dateLabel = formatInstantForUser(sourceIso);
  const titleWithDate =
    dateLabel && s.recordType === "gmail_message" ? `${title} · ${dateLabel}` : title;
  const metaDigest =
    typeof s.metadata?.digest === "string" ? s.metadata.digest.trim() : "";
  return {
    entityType: "source_record",
    entityId: s.id,
    title: titleWithDate,
    digest: metaDigest || null,
    text: `${aliases} source=${s.recordType}${mailboxBit}${
      dateLabel ? ` Date=${dateLabel}` : ""
    } ${title}${senderBits}\n${(s.recordText ?? "").slice(0, 800)}`,
    recordType: s.recordType,
    mailbox: s.mailbox,
    updatedAt: sourceIso,
  };
}

/**
 * Load Google + other connector records without letting contacts (or one mailbox)
 * crowd out mail from every connected account.
 */
async function loadSourceRecordsBalanced(userId: string): Promise<ContextRecord[]> {
  const googleConns = await getDb()
    .select({
      id: connectors.id,
      settings: connectors.settings,
    })
    .from(connectors)
    .where(
      and(
        eq(connectors.userId, userId),
        eq(connectors.type, "google"),
        eq(connectors.enabled, true),
      ),
    );

  const out: ContextRecord[] = [];
  const seen = new Set<string>();

  const pushRows = (rows: SourceRow[]) => {
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(sourceRowToContext(row));
    }
  };

  // Equal share of recent Gmail from each connected Google account.
  for (const conn of googleConns) {
    const mailbox = connectorGoogleEmail(conn.settings);
    const rows = await getDb()
      .select({
        id: sourceRecords.id,
        recordType: sourceRecords.recordType,
        recordTitle: sourceRecords.recordTitle,
        recordText: sourceRecords.recordText,
        updatedAt: sourceRecords.updatedAt,
        sourceCreatedAt: sourceRecords.sourceCreatedAt,
        metadata: sourceRecords.recordMetadata,
      })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.userId, userId),
          eq(sourceRecords.connectorId, conn.id),
          eq(sourceRecords.recordType, "gmail_message"),
        ),
      )
      .orderBy(
        desc(sql`coalesce(${sourceRecords.sourceCreatedAt}, ${sourceRecords.updatedAt})`),
      )
      .limit(CORPUS.gmailPerMailbox);

    pushRows(rows.map((r) => ({ ...r, mailbox })));
  }

  // Smaller buckets for other Google record types (contacts used to dominate Ask).
  for (const [recordType, limit] of [
    ["google_contact", CORPUS.contactsTotal],
    ["drive_file", CORPUS.driveTotal],
    ["calendar_event", CORPUS.calendarTotal],
  ] as const) {
    const rows = await getDb()
      .select({
        id: sourceRecords.id,
        recordType: sourceRecords.recordType,
        recordTitle: sourceRecords.recordTitle,
        recordText: sourceRecords.recordText,
        updatedAt: sourceRecords.updatedAt,
        sourceCreatedAt: sourceRecords.sourceCreatedAt,
        connectorId: sourceRecords.connectorId,
        metadata: sourceRecords.recordMetadata,
      })
      .from(sourceRecords)
      .where(
        and(eq(sourceRecords.userId, userId), eq(sourceRecords.recordType, recordType)),
      )
      .orderBy(
        desc(sql`coalesce(${sourceRecords.sourceCreatedAt}, ${sourceRecords.updatedAt})`),
      )
      .limit(limit);

    const mailboxByConnector = new Map(
      googleConns.map((c) => [c.id, connectorGoogleEmail(c.settings)] as const),
    );
    pushRows(
      rows.map((r) => ({
        id: r.id,
        recordType: r.recordType,
        recordTitle: r.recordTitle,
        recordText: r.recordText,
        updatedAt: r.updatedAt,
        sourceCreatedAt: r.sourceCreatedAt,
        mailbox: mailboxByConnector.get(r.connectorId) ?? null,
        metadata: r.metadata,
      })),
    );
  }

  return out;
}

async function collectCorpus(
  userId: string,
): Promise<{
  records: ContextRecord[];
  people: PersonRef[];
  tasks: Awaited<ReturnType<typeof listTasksForUser>>;
}> {
  const [tasks, notes, people, knowledge, memories, documents, captures, attentionList, vehiclesList, homesList, warrantiesList, orgsList, invoicesList, projectsList, sources, aliases] =
    await Promise.all([
      listTasksForUser(userId, { limit: CORPUS.tasks }),
      listNotesForUser(userId, { limit: CORPUS.notes }),
      listPeopleForUser(userId, { limit: CORPUS.people }),
      listKnowledgeForUser(userId, { limit: CORPUS.knowledge }),
      listMemoriesForUser(userId, { limit: CORPUS.memories }),
      listDocumentsForUser(userId, { limit: CORPUS.documents }),
      listCapturesForUser(userId, { limit: CORPUS.captures }),
      listAttentionForToday(userId, CORPUS.attention),
      listVehiclesForUser(userId, { limit: CORPUS.vehicles }),
      listHomesForUser(userId, { limit: CORPUS.homes }),
      listWarrantiesForUser(userId, { limit: CORPUS.warranties }),
      listOrganizationsForUser(userId, { limit: CORPUS.organizations }),
      listInvoicesForUser(userId, { limit: CORPUS.invoices }),
      listProjectsForRetrieval(userId, CORPUS.projects),
      loadSourceRecordsBalanced(userId),
      listPersonNameAliases(userId),
    ]);

  const records: ContextRecord[] = [];
  const personById = new Map(people.map((p) => [p.id, p] as const));

  for (const m of memories.slice(0, CORPUS.memories)) {
    const linked = m.primaryPersonId ? personById.get(m.primaryPersonId) : undefined;
    const personName =
      linked?.displayName ??
      ([linked?.firstName, linked?.lastName].filter(Boolean).join(" ").trim() || null);
    const digest = m.summary?.trim() || null;
    records.push({
      entityType: "memory",
      entityId: m.id,
      title: m.title,
      digest,
      text: memoryEmbeddingText({
        domain: m.domain,
        title: m.title,
        content: m.content,
        tags: m.tags,
        primaryPersonId: m.primaryPersonId,
        personName,
        pinned: m.pinned,
        // Keep full content in `text` for keyword/FTS reliability; digest used for embed.
        summary: undefined,
      }),
      pinned: m.pinned,
      expandPreferred: m.pinned,
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
    const digest =
      n.summary?.trim() ||
      (n.factBullets?.length ? n.factBullets.slice(0, 6).join("; ") : null);
    records.push({
      entityType: "note",
      entityId: n.id,
      title: n.title,
      digest,
      text: noteRetrievalText(n),
      expandPreferred: Boolean(n.pinned),
    });
  }
  for (const p of people.slice(0, CORPUS.people)) {
    const fullName =
      [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || p.displayName;
    records.push({
      entityType: "person",
      entityId: p.id,
      title: fullName,
      text: personEmbeddingText(p),
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
    const digest = d.summary?.trim() || null;
    records.push({
      entityType: "document",
      entityId: d.id,
      title: d.fileName,
      digest,
      text: `${d.fileName}\n${(d.summary ?? d.extractedText ?? "").slice(0, 600)}`,
    });
  }
  for (const c of captures) {
    records.push({
      entityType: "capture",
      entityId: c.id,
      title: c.title || "Capture",
      digest: c.digest?.trim() || null,
      text: `${c.title ?? ""}\n${(c.rawText ?? "").slice(0, 500)}`,
    });
  }
  for (const a of attentionList.slice(0, CORPUS.attention)) {
    records.push({
      entityType: "attention_item",
      entityId: a.id,
      title: a.title,
      digest: a.summary?.trim() || null,
      text: `reminder: ${a.title} due=${a.dueAt} kind=${a.kind}${
        a.summary ? ` — ${a.summary}` : ""
      }${a.evidenceText ? ` (${a.evidenceText})` : ""}`,
    });
  }
  for (const v of vehiclesList.slice(0, CORPUS.vehicles)) {
    records.push({
      entityType: "vehicle",
      entityId: v.id,
      title: v.displayName,
      text: [
        `vehicle ${v.displayName}`,
        v.year ? `year=${v.year}` : null,
        v.make ? `make=${v.make}` : null,
        v.model ? `model=${v.model}` : null,
        v.vin ? `vin=${v.vin}` : null,
        v.licensePlate ? `plate=${v.licensePlate}` : null,
        v.notes ? `notes=${v.notes.slice(0, 400)}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  for (const h of homesList.slice(0, CORPUS.homes)) {
    records.push({
      entityType: "home",
      entityId: h.id,
      title: h.displayName,
      text: [
        `home property ${h.displayName}`,
        h.addressLine1 ? `address=${h.addressLine1}` : null,
        h.addressLine2 ? h.addressLine2 : null,
        h.city ? `city=${h.city}` : null,
        h.region ? `region=${h.region}` : null,
        h.postalCode ? `postal=${h.postalCode}` : null,
        h.notes ? `notes=${h.notes.slice(0, 400)}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  for (const w of warrantiesList.slice(0, CORPUS.warranties)) {
    records.push({
      entityType: "warranty",
      entityId: w.id,
      title: w.title,
      text: [
        `warranty ${w.title}`,
        `subject=${w.subjectType}`,
        w.subjectName ? `for=${w.subjectName}` : null,
        w.provider ? `provider=${w.provider}` : null,
        w.expiresAt ? `expires=${w.expiresAt}` : null,
        w.notes ? `notes=${w.notes.slice(0, 400)}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  for (const o of orgsList.slice(0, CORPUS.organizations)) {
    records.push({
      entityType: "organization",
      entityId: o.id,
      title: o.displayName,
      text: [
        `organization ${o.displayName}`,
        `type=${o.orgType}`,
        o.email ? `email=${o.email}` : null,
        o.phone ? `phone=${o.phone}` : null,
        o.website ? `website=${o.website}` : null,
        o.notes ? `notes=${o.notes.slice(0, 400)}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  for (const inv of invoicesList.slice(0, CORPUS.invoices)) {
    records.push({
      entityType: "invoice",
      entityId: inv.id,
      title: inv.title,
      text: [
        `invoice ${inv.title}`,
        inv.organizationName ? `vendor=${inv.organizationName}` : null,
        inv.amountCents != null
          ? `amount=${inv.currency} ${(inv.amountCents / 100).toFixed(2)}`
          : null,
        `status=${inv.status}`,
        inv.dueDate ? `due=${inv.dueDate}` : null,
        inv.invoiceDate ? `invoiced=${inv.invoiceDate}` : null,
        inv.notes ? `notes=${inv.notes.slice(0, 400)}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  for (const p of projectsList.slice(0, CORPUS.projects)) {
    records.push({
      entityType: "project",
      entityId: p.id,
      title: p.name,
      text: [
        `project ${p.name}`,
        `status=${p.status}`,
        p.description ? `description=${p.description.slice(0, 500)}` : null,
        p.relatedPeople.length ? `people=${p.relatedPeople.join(",")}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  records.push(...sources);

  const peopleRefs: PersonRef[] = people.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    email: p.email ?? null,
    firstName: p.firstName ?? null,
    lastName: p.lastName ?? null,
    role: p.role ?? null,
    notes: p.notes ?? null,
  }));

  return {
    records,
    people: peopleWithAliasNames(peopleRefs, aliases),
    // Surfaced so callers (query-engine) can reuse the raw task list instead of
    // issuing a second listTasksForUser query on the same request.
    tasks,
  };
}

/**
 * Hybrid retrieval: keyword + semantic embeddings (when available).
 * Vectors are L1 (memory) + L2 (entity_embeddings) cached by content hash.
 *
 * @param noteSearchQuery Prefer the current user turn alone for note FTS so
 * prior thread turns (emails, etc.) don't AND-pollute the notes query.
 */
export async function retrieveRelevantRecords(
  userId: string,
  question: string,
  limit = 16,
  options?: { noteSearchQuery?: string },
): Promise<{
  records: RetrievedRecord[];
  usedSemantic: boolean;
  namedPeople: {
    id: string;
    displayName: string;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }[];
  tasks: Awaited<ReturnType<typeof listTasksForUser>>;
}> {
  const noteQuery = (options?.noteSearchQuery ?? question).trim() || question;
  // Embed the query in parallel with the corpus load — it doesn't depend on the
  // corpus, so this removes a sequential OpenAI round-trip from the critical path.
  const [{ records: baseCorpus, people, tasks }, noteSearchHits, queryVec] = await Promise.all([
    collectCorpus(userId),
    searchNotesForUser(userId, noteQuery, 20).catch(() => []),
    embedQuery(question).catch(() => null),
  ]);
  const corpus = [...baseCorpus];
  const corpusNoteIds = new Set(
    corpus.filter((r) => r.entityType === "note").map((r) => r.entityId),
  );
  // Full-library note search covers older notes outside the recency corpus cap.
  for (const note of noteSearchHits) {
    if (corpusNoteIds.has(note.id)) continue;
    corpus.push({
      entityType: "note",
      entityId: note.id,
      title: note.title,
      text: noteRetrievalText(note),
    });
    corpusNoteIds.add(note.id);
  }
  if (corpus.length === 0) {
    return { records: [], usedSemantic: false, namedPeople: [], tasks };
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
  const linkedBundle =
    named.length > 0
      ? await loadLinkedContextRecordsForPeople(userId, [...namedIds], {
          excludeKeys: new Set(corpus.map((r) => `${r.entityType}:${r.entityId}`)),
          limit: 40,
        })
      : { links: [], records: [] };
  const linkedToNamed = linkedEntityKeySet(linkedBundle.links);
  // Force older person-linked records into the corpus (beyond recency caps).
  for (const r of linkedBundle.records) {
    corpus.push({
      entityType: r.entityType,
      entityId: r.entityId,
      title: r.title,
      text: r.text,
      pinned: r.pinned,
    });
  }
  const namedTokens = named.flatMap((p) => {
    const parts = p.displayName.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    return [p.displayName.toLowerCase(), ...parts];
  });
  const personTagNeedles = named.map((p) => `person:${p.displayName.toLowerCase()}`);

  const mailboxes = [
    ...new Set(
      corpus
        .map((r) => r.mailbox?.toLowerCase())
        .filter((m): m is string => Boolean(m)),
    ),
  ];
  const mailboxHint = extractMailboxHint(question, mailboxes);

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
    if (linkedToNamed.has(`${r.entityType}:${r.entityId}`)) return 0.42;
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
    let boost = 0;
    if (sender >= 0.8) boost = 0.7 + sender * 0.25; // prefer sender-matched mail
    else if (wantsGoogle && r.entityType === "source_record") {
      if (
        sourceRecordMatchesIntent(r.recordType, intent) ||
        senderMatchedMail.length > 0
      ) {
        if (r.recordType === "gmail_message" && (intent.email || senderMatchedMail.length > 0)) {
          boost = 0.55;
        } else if (sourceRecordMatchesIntent(r.recordType, intent)) {
          boost = 0.55;
        }
      }
    }
    if (
      boost > 0 &&
      mailboxHint &&
      r.recordType === "gmail_message" &&
      r.mailbox?.toLowerCase() === mailboxHint
    ) {
      boost += 0.35;
    }
    return boost;
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

      // When pgvector is available, pull ANN neighbors into the candidate set.
      const corpusById = new Map(corpus.map((r) => [`${r.entityType}:${r.entityId}`, r]));
      const pgHits = await rankEntitiesByPgvector({
        userId,
        query: queryVec,
        limit: CORPUS.semanticCandidates,
      });
      if (pgHits) {
        for (const hit of pgHits) {
          const id = `${hit.entityType}:${hit.entityId}`;
          const row = corpusById.get(id);
          if (!row || shortlistIds.has(id)) continue;
          shortlistIds.add(id);
          candidates.push(row);
          // Cosine distance → similarity for scoring (js cosine still refines below).
          semanticScores.set(id, Math.max(0, 1 - hit.distance));
        }
      }

      for (const r of corpus) {
        const id = `${r.entityType}:${r.entityId}`;
        if (shortlistIds.has(id)) continue;
        candidates.push(r);
        if (candidates.length >= CORPUS.semanticCandidates) break;
      }

      const metricsBefore = getEmbeddingCacheMetrics();
      const vectors = await embedItemsCached(
        userId,
        candidates.map((r) => ({
          entityType: r.entityType,
          entityId: r.entityId,
          text: embeddingTextForContextRecord(r),
        })),
      );

      if (vectors) {
        usedSemantic = true;
        for (const r of candidates) {
          const vec = vectors.get(`${r.entityType}:${r.entityId}`);
          if (!vec) continue;
          semanticScores.set(`${r.entityType}:${r.entityId}`, cosineSimilarity(queryVec, vec));
        }
        const m = getEmbeddingCacheMetrics();
        const apiCalls =
          m.itemApiCalls -
          metricsBefore.itemApiCalls +
          (m.queryApiCalls - metricsBefore.queryApiCalls);
        const hits = m.itemHits - metricsBefore.itemHits;
        const misses = m.itemMisses - metricsBefore.itemMisses;
        const denom = hits + misses;
        logger.debug(
          {
            embed_cache_hit_rate: denom === 0 ? 1 : Number((hits / denom).toFixed(3)),
            embed_api_calls_per_ask: apiCalls,
            embed_item_hits: hits,
            embed_item_misses: misses,
            candidates: candidates.length,
          },
          "ask_embed_metrics",
        );
      } else if (semanticScores.size > 0) {
        // pgvector ANN scores alone are usable when embed API is degraded.
        usedSemantic = true;
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
      recordType: r.recordType,
      updatedAt: r.updatedAt,
      digest: r.digest ?? null,
      pinned: r.pinned,
      expandPreferred: r.expandPreferred,
    };
  };

  let top = scored
    .filter((x) => x.score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r, score, method }) => toRetrieved(r, score, method));

  // Force-include full-library note FTS hits so older notes (and keyword matches
  // below the semantic threshold) aren't crowded out by Gmail/memory boosts.
  if (noteSearchHits.length > 0) {
    const already = new Set(top.map((r) => `${r.entityType}:${r.entityId}`));
    const noteById = new Map(
      corpus
        .filter((r) => r.entityType === "note")
        .map((r) => [r.entityId, r] as const),
    );
    const injected: RetrievedRecord[] = [];
    for (const note of noteSearchHits.slice(0, Math.min(8, limit))) {
      const key = `note:${note.id}`;
      if (already.has(key)) continue;
      const r = noteById.get(note.id);
      if (!r) continue;
      injected.push(toRetrieved(r, 1.05, "keyword"));
      already.add(key);
    }
    if (injected.length > 0) {
      top = [...injected, ...top].slice(
        0,
        Math.max(limit, Math.min(16, injected.length + 6)),
      );
    }
  }

  // Prefer emails whose From name/address matches the asked-about person.
  // Always pull recent mail from EACH connected mailbox so REI / personal aren't starved.
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

    if (intent.email) {
      const gmailByMailbox = new Map<string, ContextRecord[]>();
      for (const r of corpus) {
        if (r.entityType !== "source_record" || r.recordType !== "gmail_message") continue;
        if (mailboxHint && r.mailbox?.toLowerCase() !== mailboxHint) continue;
        const key = r.mailbox?.toLowerCase() || "unknown";
        const list = gmailByMailbox.get(key) ?? [];
        list.push(r);
        gmailByMailbox.set(key, list);
      }
      const perMailbox = Math.max(3, Math.floor(Math.min(12, limit) / Math.max(1, gmailByMailbox.size)));
      for (const [, mails] of gmailByMailbox) {
        let added = 0;
        for (const r of mails) {
          if (already.has(r.entityId)) continue;
          const mailboxBoost =
            mailboxHint && r.mailbox?.toLowerCase() === mailboxHint ? 0.15 : 0;
          injected.push(toRetrieved(r, 0.95 + mailboxBoost, "keyword"));
          already.add(r.entityId);
          added += 1;
          if (added >= perMailbox) break;
        }
      }
    }

    if (injected.length > 0) {
      top = [...injected, ...top].slice(0, Math.max(limit, Math.min(16, injected.length + 4)));
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

  // Force-include entity-linked records for named people (beyond corpus recency).
  if (named.length > 0 && linkedBundle.records.length > 0) {
    const already = new Set(top.map((r) => `${r.entityType}:${r.entityId}`));
    const injected: RetrievedRecord[] = [];
    for (const r of linkedBundle.records.slice(0, Math.min(10, limit))) {
      const key = `${r.entityType}:${r.entityId}`;
      if (already.has(key)) continue;
      injected.push(
        toRetrieved(
          {
            entityType: r.entityType,
            entityId: r.entityId,
            title: r.title,
            text: r.text,
            pinned: r.pinned,
          },
          1.05,
          "keyword",
        ),
      );
      already.add(key);
    }
    if (injected.length > 0) {
      top = [...injected, ...top].slice(0, Math.max(limit, Math.min(16, injected.length + 4)));
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
      tasks,
    };
  }

  return { records: top, usedSemantic, namedPeople: named, tasks };
}
