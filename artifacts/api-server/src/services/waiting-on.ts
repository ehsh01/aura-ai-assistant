import { and, desc, eq, sql } from "drizzle-orm";
import { sourceRecords, waitingDismissals } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { getNoteForUser, listNoteMetadataForUser } from "./notes";
import { getKnowledgeForUser, listKnowledgeForUser } from "./knowledge";
import { createPersonForUser, listPeopleForUser } from "./people";
import { createTaskForUser, listTasksForUser, type RecallTaskDto } from "./tasks";
import { createEvidenceForUser } from "./evidence";
import { writeAuditLog } from "./audit";
import { listPersonNameAliases, peopleWithAliasNames } from "./user-corrections";
import {
  listWaitingDueForUser,
  listWaitingItemsForUser,
  getWaitingItemForUser,
  type WaitingDueReason,
} from "./waiting-items";

const WAITING_RE =
  /\b(waiting|follow[- ]?up|awaiting|need(?:s)? (?:a |the )?(?:quote|reply|response|call|email)|still need|pending (?:from|on)|haven't heard|no response)\b/i;

/** Ignore archive noise — only surface waiting items from yesterday or today. */
const WAITING_MAX_AGE_DAYS = 1;

export type WaitingOnItem = {
  id: string;
  person: string;
  personId: string | null;
  item: string;
  days: number;
  href: string;
  followUp: string;
  sourceType: "note" | "knowledge" | "task" | "mail" | "durable";
  evidenceText: string;
  /** Durable commitments only: why this belongs on Today right now. */
  dueReason?: WaitingDueReason;
};

function daysSince(iso?: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

const NON_NAME =
  /^(Still|Need|Needs|Waiting|Follow|Pending|Quote|Reply|Response|Call|Email|Text|Ask|Tell|Buy|Get|Send|Check|Review|Open|Close|The|This|That|Before|After|Until|About|From|With|For|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)$/;

/** Exported for unit tests — prefer known people, then from/with/for names. */
export function extractPerson(text: string, peopleNames: string[]): string {
  // Prefer known people: full name, then first-name word match.
  const lower = text.toLowerCase();
  for (const name of peopleNames) {
    const n = name.trim();
    if (n.length < 2) continue;
    if (lower.includes(n.toLowerCase())) return n;
  }
  for (const name of peopleNames) {
    const first = name.trim().split(/\s+/)[0] ?? "";
    if (first.length < 2 || NON_NAME.test(first)) continue;
    if (new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
      return name.trim();
    }
  }
  // Prefer a single capitalized token after from/with/for — two-word names
  // often swallow the next sentence word ("Mike Still need…").
  const from = text.match(/\b(?:from|with|for)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/);
  if (from?.[1] && !NON_NAME.test(from[1])) {
    if (from[2] && !NON_NAME.test(from[2])) return `${from[1]} ${from[2]}`;
    return from[1];
  }
  // "Call Mike…", "Email Jane…", "Ask Bob…"
  const verb = text.match(
    /\b(?:call|email|text|ask|tell|ping|message)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/i,
  );
  if (verb?.[1] && !NON_NAME.test(verb[1])) {
    // Preserve original capitalization from the match source when possible.
    const nameMatch = text.match(
      /\b(?:[Cc]all|[Ee]mail|[Tt]ext|[Aa]sk|[Tt]ell|[Pp]ing|[Mm]essage)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/,
    );
    const first = nameMatch?.[1] ?? verb[1];
    const second = nameMatch?.[2];
    if (second && !NON_NAME.test(second)) return `${first} ${second}`;
    return first;
  }
  // Skip action words / days; take the first remaining capitalized token.
  const tokens = text.match(/\b([A-Z][a-z]{2,})\b/g) ?? [];
  for (const token of tokens) {
    if (!NON_NAME.test(token)) return token;
  }
  return "Someone";
}

export function matchPersonId(
  personName: string,
  people: { id: string; displayName: string }[],
  aliases?: Map<string, string>,
): string | null {
  const lower = personName.toLowerCase();
  const aliasId = aliases?.get(lower);
  if (aliasId) return aliasId;
  const hit = people.find(
    (p) =>
      p.displayName.toLowerCase() === lower ||
      p.displayName.toLowerCase().includes(lower) ||
      lower.includes(p.displayName.toLowerCase()),
  );
  return hit?.id ?? null;
}

/**
 * Merge durable tracked commitments ahead of heuristic rows, suppressing
 * heuristic rows whose source is already tracked and honoring dismissals.
 */
export function mergeWaitingOnLists(input: {
  durable: WaitingOnItem[];
  heuristic: WaitingOnItem[];
  dismissedIds: Set<string>;
  suppressHeuristicIds: Set<string>;
  limit: number;
}): WaitingOnItem[] {
  const byDaysDesc = (a: WaitingOnItem, b: WaitingOnItem) => b.days - a.days;
  const durable = input.durable
    .filter((item) => !input.dismissedIds.has(item.id))
    .sort(byDaysDesc);
  const heuristic = input.heuristic
    .filter(
      (item) =>
        !input.dismissedIds.has(item.id) && !input.suppressHeuristicIds.has(item.id),
    )
    .sort(byDaysDesc);
  return [...durable, ...heuristic].slice(0, input.limit);
}

/**
 * Build a cross-source "waiting on others" list with evidence snippets.
 */
export async function listWaitingOnForUser(
  userId: string,
  limitOrOpts: number | { limit?: number; maxAgeDays?: number; minAgeDays?: number } = 20,
): Promise<WaitingOnItem[]> {
  const opts =
    typeof limitOrOpts === "number"
      ? { limit: limitOrOpts }
      : limitOrOpts;
  const limit = opts.limit ?? 20;
  const maxAgeDays = opts.maxAgeDays ?? WAITING_MAX_AGE_DAYS;
  const minAgeDays = opts.minAgeDays ?? 0;

  const [notes, knowledge, people, tasks, aliases] = await Promise.all([
    listNoteMetadataForUser(userId),
    listKnowledgeForUser(userId),
    listPeopleForUser(userId),
    listTasksForUser(userId),
    listPersonNameAliases(userId),
  ]);

  const peopleForMatch = peopleWithAliasNames(people, aliases);
  const peopleNames = peopleForMatch.map((p) => p.displayName).filter(Boolean);
  const items: WaitingOnItem[] = [];

  // Durable tracked commitments come first; heuristic rows whose source is
  // already tracked are suppressed below.
  const [dueDurable, activeDurable] = await Promise.all([
    listWaitingDueForUser(userId),
    listWaitingItemsForUser(userId, { status: "active", limit: 200 }),
  ]);
  const durableItems: WaitingOnItem[] = dueDurable.map((d) => ({
    id: `durable:${d.id}`,
    person: d.ownerName,
    personId: d.ownerPersonId,
    item: d.deliverable.slice(0, 120),
    days: daysSince(d.promisedAt ?? d.createdAt),
    href: `/waiting/${d.id}`,
    followUp:
      d.dueReason === "needs_review"
        ? `Review reply from ${d.ownerName}`
        : d.dueReason === "expected_overdue"
          ? `Follow up with ${d.ownerName} — was expected ${
              d.expectedAt ? d.expectedAt.slice(0, 10) : "earlier"
            }`
          : `Follow up with ${d.ownerName}`,
    sourceType: "durable",
    evidenceText:
      (typeof d.metadata?.evidenceSnippet === "string"
        ? d.metadata.evidenceSnippet
        : d.deliverable
      ).slice(0, 280),
    dueReason: d.dueReason,
  }));

  const suppressHeuristicIds = new Set<string>();
  const trackedThreadIds = new Set<string>();
  for (const d of activeDurable) {
    if (d.sourceEntityType === "source_record") {
      suppressHeuristicIds.add(`mail:${d.sourceEntityId}`);
    } else if (
      d.sourceEntityType === "note" ||
      d.sourceEntityType === "task" ||
      d.sourceEntityType === "knowledge"
    ) {
      suppressHeuristicIds.add(`${d.sourceEntityType}:${d.sourceEntityId}`);
    }
    if (d.threadId) trackedThreadIds.add(d.threadId);
  }

  for (const n of notes) {
    const blob = `${n.title} ${n.preview}`;
    if (!WAITING_RE.test(blob)) continue;
    const age = daysSince(n.updatedAt ?? n.createdAt);
    if (age < minAgeDays || age > maxAgeDays) continue;
    const person = extractPerson(blob, peopleNames);
    items.push({
      id: `note:${n.id}`,
      person,
      personId: matchPersonId(person, people, aliases),
      item: n.title,
      days: age,
      href: `/notes?note=${encodeURIComponent(n.id)}`,
      followUp: `Follow up with ${person}`,
      sourceType: "note",
      evidenceText: blob.slice(0, 280),
    });
  }

  for (const k of knowledge) {
    const blob = `${k.title} ${k.content}`;
    if (!WAITING_RE.test(blob)) continue;
    const age = daysSince(k.updatedAt ?? k.createdAt);
    if (age < minAgeDays || age > maxAgeDays) continue;
    const person = extractPerson(blob, peopleNames);
    items.push({
      id: `knowledge:${k.id}`,
      person,
      personId: matchPersonId(person, people, aliases),
      item: k.title,
      days: age,
      href: `/knowledge?item=${encodeURIComponent(k.id)}`,
      followUp: `Follow up with ${person}`,
      sourceType: "knowledge",
      evidenceText: blob.slice(0, 280),
    });
  }

  // Open waiting tasks must age out the same as notes — previously they always
  // used days: 0 and never left Waiting on / Start here, so stale follow-ups
  // (Kenneth bills, old doctor follow-ups, etc.) stuck forever.
  for (const t of tasks.filter((x) => !x.completed && WAITING_RE.test(x.title))) {
    const age = daysSince(t.updatedAt ?? t.createdAt);
    if (age < minAgeDays || age > maxAgeDays) continue;
    const person = extractPerson(t.title, peopleNames);
    items.push({
      id: `task:${t.id}`,
      person,
      personId: matchPersonId(person, people, aliases),
      item: t.title,
      days: age,
      href: `/tasks?task=${encodeURIComponent(t.id)}`,
      followUp: `Follow up with ${person}`,
      sourceType: "task",
      evidenceText: t.title,
    });
  }

  // Recent Gmail that looks like a follow-up is needed (slightly wider age window).
  const mailMaxAge = Math.max(maxAgeDays, 3);
  const mailRows = await getDb()
    .select({
      id: sourceRecords.id,
      recordTitle: sourceRecords.recordTitle,
      recordText: sourceRecords.recordText,
      sourceCreatedAt: sourceRecords.sourceCreatedAt,
      updatedAt: sourceRecords.updatedAt,
      metadata: sourceRecords.recordMetadata,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.recordType, "gmail_message"),
      ),
    )
    .orderBy(desc(sql`coalesce(${sourceRecords.sourceCreatedAt}, ${sourceRecords.updatedAt})`))
    .limit(80);

  for (const m of mailRows) {
    const blob = `${m.recordTitle ?? ""} ${m.recordText ?? ""}`;
    if (!WAITING_RE.test(blob)) continue;
    const mailThreadId =
      typeof m.metadata?.threadId === "string" ? m.metadata.threadId : null;
    if (mailThreadId && trackedThreadIds.has(mailThreadId)) continue;
    const iso =
      m.sourceCreatedAt?.toISOString() ||
      (typeof m.metadata?.date === "string" ? m.metadata.date : null) ||
      m.updatedAt.toISOString();
    const age = daysSince(iso);
    if (age < minAgeDays || age > mailMaxAge) continue;
    const person = extractPerson(blob, peopleNames);
    items.push({
      id: `mail:${m.id}`,
      person,
      personId: matchPersonId(person, people, aliases),
      item: (m.recordTitle ?? "Email").slice(0, 120),
      days: age,
      href: "/ask",
      followUp: `Follow up with ${person}`,
      sourceType: "mail",
      evidenceText: blob.slice(0, 280),
    });
  }

  const dismissed = await listDismissedWaitingItemIds(userId);
  return mergeWaitingOnLists({
    durable: durableItems,
    heuristic: items,
    dismissedIds: dismissed,
    suppressHeuristicIds,
    limit,
  });
}

async function listDismissedWaitingItemIds(userId: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ waitingItemId: waitingDismissals.waitingItemId })
    .from(waitingDismissals)
    .where(eq(waitingDismissals.userId, userId));
  return new Set(rows.map((r) => r.waitingItemId));
}

/** Hide a waiting-on item from Today / People until the source id changes. */
export async function dismissWaitingOnForUser(
  userId: string,
  waitingItemId: string,
): Promise<{ ok: true; waitingItemId: string }> {
  const id = waitingItemId.trim();
  if (!id) {
    throw new Error("waitingItemId is required");
  }
  // Prefer canonical id when the source still exists.
  const resolved = await resolveWaitingItemForFollowUp(userId, id);
  const canonicalId = resolved?.id ?? id;

  await getDb()
    .insert(waitingDismissals)
    .values({
      userId,
      waitingItemId: canonicalId.slice(0, 128),
    })
    .onConflictDoNothing({
      target: [waitingDismissals.userId, waitingDismissals.waitingItemId],
    });

  // Also store the raw id the client sent (legacy bare note UUID).
  if (canonicalId !== id) {
    await getDb()
      .insert(waitingDismissals)
      .values({
        userId,
        waitingItemId: id.slice(0, 128),
      })
      .onConflictDoNothing({
        target: [waitingDismissals.userId, waitingDismissals.waitingItemId],
      });
  }

  await writeAuditLog({
    userId,
    action: "waiting_dismissed",
    entityType: resolved?.sourceType ?? "waiting",
    entityId: canonicalId,
    metadata: { waitingItemId: canonicalId },
  });

  return { ok: true, waitingItemId: canonicalId };
}

export type FollowUpResult = {
  task: RecallTaskDto;
  personId: string | null;
  waitingItemId: string;
};

/**
 * Resolve a waiting-on id to its source, without re-applying age / keyword filters.
 * Follow-up must work for anything the UI already showed — those filters can diverge
 * between list time, client fallback, and create time.
 */
export async function resolveWaitingItemForFollowUp(
  userId: string,
  waitingItemId: string,
): Promise<WaitingOnItem | null> {
  const raw = waitingItemId.trim();
  if (!raw) return null;

  let sourceType: WaitingOnItem["sourceType"];
  let sourceId: string;
  const colon = raw.indexOf(":");
  if (colon > 0) {
    const prefix = raw.slice(0, colon);
    sourceId = raw.slice(colon + 1);
    if (prefix === "durable") {
      const d = await getWaitingItemForUser(userId, sourceId);
      if (!d) return null;
      return {
        id: `durable:${d.id}`,
        person: d.ownerName,
        personId: d.ownerPersonId,
        item: d.deliverable.slice(0, 120),
        days: daysSince(d.promisedAt ?? d.createdAt),
        href: `/waiting/${d.id}`,
        followUp: `Follow up with ${d.ownerName}`,
        sourceType: "durable",
        evidenceText:
          (typeof d.metadata?.evidenceSnippet === "string"
            ? d.metadata.evidenceSnippet
            : d.deliverable
          ).slice(0, 280),
      };
    }
    if (
      prefix === "note" ||
      prefix === "knowledge" ||
      prefix === "task" ||
      prefix === "mail"
    ) {
      sourceType = prefix;
    } else {
      return null;
    }
  } else {
    // Legacy client fallbacks sent bare note UUIDs.
    sourceType = "note";
    sourceId = raw;
  }
  if (!sourceId) return null;

  const [people, aliases] = await Promise.all([
    listPeopleForUser(userId),
    listPersonNameAliases(userId),
  ]);
  const peopleForMatch = peopleWithAliasNames(people, aliases);
  const peopleNames = peopleForMatch.map((p) => p.displayName).filter(Boolean);

  if (sourceType === "note") {
    const n = await getNoteForUser(userId, sourceId);
    if (!n) return null;
    const blob = `${n.title} ${n.content ?? ""}`;
    const person = extractPerson(blob, peopleNames);
    return {
      id: `note:${n.id}`,
      person,
      personId: matchPersonId(person, people, aliases) ?? n.primaryPersonId ?? null,
      item: n.title,
      days: daysSince(n.updatedAt ?? n.createdAt),
      href: `/notes?note=${encodeURIComponent(n.id)}`,
      followUp: `Follow up with ${person}`,
      sourceType: "note",
      evidenceText: blob.slice(0, 280),
    };
  }

  if (sourceType === "knowledge") {
    const k = await getKnowledgeForUser(userId, sourceId);
    if (!k) return null;
    const blob = `${k.title} ${k.content}`;
    const person = extractPerson(blob, peopleNames);
    return {
      id: `knowledge:${k.id}`,
      person,
      personId: matchPersonId(person, people, aliases) ?? k.primaryPersonId ?? null,
      item: k.title,
      days: daysSince(k.updatedAt ?? k.createdAt),
      href: `/knowledge?item=${encodeURIComponent(k.id)}`,
      followUp: `Follow up with ${person}`,
      sourceType: "knowledge",
      evidenceText: blob.slice(0, 280),
    };
  }

  if (sourceType === "mail") {
    const rows = await getDb()
      .select({
        id: sourceRecords.id,
        recordTitle: sourceRecords.recordTitle,
        recordText: sourceRecords.recordText,
        sourceCreatedAt: sourceRecords.sourceCreatedAt,
        updatedAt: sourceRecords.updatedAt,
      })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.id, sourceId),
          eq(sourceRecords.userId, userId),
          eq(sourceRecords.recordType, "gmail_message"),
        ),
      )
      .limit(1);
    const m = rows[0];
    if (!m) return null;
    const blob = `${m.recordTitle ?? ""} ${m.recordText ?? ""}`;
    const person = extractPerson(blob, peopleNames);
    return {
      id: `mail:${m.id}`,
      person,
      personId: matchPersonId(person, people, aliases),
      item: (m.recordTitle ?? "Email").slice(0, 120),
      days: daysSince(m.sourceCreatedAt?.toISOString() ?? m.updatedAt.toISOString()),
      href: "/ask",
      followUp: `Follow up with ${person}`,
      sourceType: "mail",
      evidenceText: blob.slice(0, 280),
    };
  }

  const tasks = await listTasksForUser(userId);
  const t = tasks.find((x) => x.id === sourceId);
  if (!t) return null;
  const person = extractPerson(t.title, peopleNames);
  return {
    id: `task:${t.id}`,
    person,
    personId: matchPersonId(person, people, aliases) ?? t.requesterPersonId ?? null,
    item: t.title,
    days: daysSince(t.updatedAt ?? t.createdAt),
    href: `/tasks?task=${encodeURIComponent(t.id)}`,
    followUp: `Follow up with ${person}`,
    sourceType: "task",
    evidenceText: t.title,
  };
}

/**
 * Turn a waiting-on item into an actionable follow-up task, linked to the
 * person when known and backed by the source evidence text.
 */
export async function createFollowUpFromWaitingOn(
  userId: string,
  waitingItemId: string,
): Promise<FollowUpResult | null> {
  const item = await resolveWaitingItemForFollowUp(userId, waitingItemId);
  if (!item) return null;

  // Source tasks already are tasks — don't duplicate; just return a pointer-style result
  // by creating a dedicated "Follow up with X" task unless the item itself is already that.
  let personId = item.personId;
  if (!personId && item.person && item.person !== "Someone") {
    const created = await createPersonForUser(userId, { displayName: item.person });
    personId = created.id;
  }

  const title =
    item.sourceType === "task" && /^follow up/i.test(item.item)
      ? item.item
      : `Follow up with ${item.person}: ${item.item}`.slice(0, 200);

  // Avoid exact-title duplicates among open tasks.
  const open = await listTasksForUser(userId);
  const existing = open.find((t) => !t.completed && t.title === title);
  if (existing) {
    return { task: existing, personId, waitingItemId: item.id };
  }

  const task = await createTaskForUser(userId, {
    title,
    priority: "high",
    tags: ["follow-up", "waiting-on"],
    requesterPersonId: personId,
    aiGenerated: false,
    userConfirmed: true,
  });

  await createEvidenceForUser(userId, {
    entityType: "task",
    entityId: task.id,
    claimType: "task_created_from",
    evidenceText: item.evidenceText.slice(0, 500),
    evidenceMetadata: {
      waitingItemId: item.id,
      sourceType: item.sourceType,
      person: item.person,
      personId,
      sourceHref: item.href,
    },
  });

  await writeAuditLog({
    userId,
    action: "follow_up_created",
    entityType: "task",
    entityId: task.id,
    metadata: {
      title: task.title,
      waitingItemId: item.id,
      person: item.person,
      personId,
      sourceType: item.sourceType,
    },
  });

  return { task, personId, waitingItemId: item.id };
}
