import { and, eq, sql } from "drizzle-orm";
import { people, tasks, waitingItems } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { logger } from "../lib/logger";
import {
  upsertWaitingItemForUser,
  type CreateWaitingItemInput,
  type WaitingItemDto,
} from "./waiting-items";
import { hasOutboundRequestCues, hasWaitingCues } from "./waiting-extract";

/**
 * User-authored follow-up statements: "waiting on Carlos", "they will send
 * the permit", "I need to hear back". Deterministic only — notes, captures,
 * and tasks matching this become review-queue candidates, never auto-open
 * commitments.
 */
export const WAITING_STATEMENT_RE =
  /\b(waiting on|waiting for|follow[ -]?up|they (will|'?ll) send|he (will|'?ll) send|she (will|'?ll) send|(will|'?ll) send (me|us|the)|need to hear back|(should|expecting to) hear back|expecting (a|the|an) (reply|response|call|email|document|confirmation)|haven'?t heard back|still waiting)\b/i;

export function hasWaitingStatement(text: string): boolean {
  return WAITING_STATEMENT_RE.test(text);
}

export type CaptureWaitingGateInput = {
  types: string[];
  confidence: number | null | undefined;
  rawText: string;
  ownerName: string | null;
};

export type CaptureWaitingGate =
  | { status: "open" | "candidate"; reason: string | null; ownerName: string }
  | null;

/** A capture only opens a commitment when the follow-up call is explicit. */
const CAPTURE_OPEN_CONFIDENCE = 0.8;

/**
 * Gate a classified capture into a waiting item. High-confidence follow-ups
 * with a named owner may open directly; anything merely plausible becomes a
 * review candidate; everything else is ignored.
 */
export function decideCaptureWaitingGate(
  input: CaptureWaitingGateInput,
): CaptureWaitingGate {
  const isFollowUp = input.types.includes("follow_up");
  const cueHit =
    hasWaitingStatement(input.rawText) ||
    hasWaitingCues(input.rawText) ||
    hasOutboundRequestCues(input.rawText);
  if (!isFollowUp && !cueHit) return null;

  const ownerName = (input.ownerName ?? "").trim();
  const confidence = input.confidence ?? 0;
  if (isFollowUp && confidence >= CAPTURE_OPEN_CONFIDENCE && ownerName) {
    return { status: "open", reason: null, ownerName: ownerName.slice(0, 200) };
  }
  const reason = isFollowUp
    ? "Classified as a follow-up — confirm to start tracking it."
    : "Mentions waiting or follow-up language — confirm to start tracking it.";
  return {
    status: "candidate",
    reason,
    ownerName: (ownerName || "Someone").slice(0, 200),
  };
}

export type NoteCandidateInput = {
  title: string;
  content: string;
  personName: string | null;
  ageDays: number;
};

/** Map a note with waiting language to a candidate, or null when quiet. */
export function decideNoteWaitingCandidate(
  input: NoteCandidateInput,
): { ownerName: string; deliverable: string; reason: string } | null {
  const blob = `${input.title}\n${input.content}`;
  if (!hasWaitingStatement(blob)) return null;
  const ownerName = (input.personName ?? "").trim() || "Someone";
  return {
    ownerName: ownerName.slice(0, 200),
    deliverable: input.title.trim().slice(0, 500) || "Follow up",
    reason:
      input.ageDays >= 1
        ? `Note mentions waiting (${Math.floor(input.ageDays)}d ago) — confirm to track it.`
        : "Note mentions waiting — confirm to track it.",
  };
}

export type TaskCandidateInput = {
  title: string;
  requesterName: string | null;
  personName: string | null;
  ageDays: number;
};

/**
 * Open tasks with explicit waiting language ("waiting on vendor for permit")
 * support a follow-up candidate; a bare requester link alone never does.
 */
export function decideTaskWaitingCandidate(
  input: TaskCandidateInput,
): { ownerName: string; deliverable: string; reason: string } | null {
  if (!hasWaitingStatement(input.title)) return null;
  const ownerName =
    (input.personName ?? "").trim() ||
    (input.requesterName ?? "").trim() ||
    "Someone";
  return {
    ownerName: ownerName.slice(0, 200),
    deliverable: input.title.trim().slice(0, 500),
    reason: `Task mentions waiting (${Math.max(1, Math.floor(input.ageDays))}d old) — confirm to track the follow-up.`,
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/** True when ANY waiting item already points at this source (any status). */
export async function waitingItemExistsForSource(
  userId: string,
  sourceEntityType: string,
  sourceEntityId: string,
): Promise<boolean> {
  const rows = await getDb()
    .select({ id: waitingItems.id })
    .from(waitingItems)
    .where(
      and(
        eq(waitingItems.userId, userId),
        eq(waitingItems.sourceEntityType, sourceEntityType),
        eq(waitingItems.sourceEntityId, sourceEntityId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function personIdForName(userId: string, name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (trimmed.length < 3) return null;
  const rows = await getDb()
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.userId, userId), sql`lower(${people.displayName}) = lower(${trimmed})`))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Create (or dedupe) a waiting item from a classified capture. Called by the
 * capture pipeline after the inbox row exists; never creates people/projects.
 */
export async function createWaitingItemFromCapture(input: {
  userId: string;
  captureItemId: string;
  rawCaptureId: string;
  types: string[];
  confidence: number | null | undefined;
  rawText: string;
  cleanedTitle: string;
  evidenceText: string | null;
  ownerName: string | null;
  ownerPersonId: string | null;
  projectId: string | null;
  sourceUrl?: string | null;
}): Promise<{ item: WaitingItemDto; created: boolean } | null> {
  const gate = decideCaptureWaitingGate({
    types: input.types,
    confidence: input.confidence,
    rawText: input.rawText,
    ownerName: input.ownerName,
  });
  if (!gate) return null;

  const result = await upsertWaitingItemForUser(input.userId, {
    ownerName: gate.ownerName,
    ownerPersonId: input.ownerPersonId,
    deliverable: input.cleanedTitle.slice(0, 500) || "Follow up",
    promisedAt: null,
    expectedAt: null,
    dateConfidence: "none",
    confidence: input.confidence ?? 0.5,
    status: gate.status,
    candidateReason: gate.reason,
    projectId: input.projectId,
    sourceEntityType: "capture_item",
    sourceEntityId: input.captureItemId,
    evidenceText: input.evidenceText ?? input.rawText.slice(0, 400),
    evidenceSnippet: (input.evidenceText ?? input.rawText).slice(0, 280),
    metadata: {
      extractedFrom: "capture_item",
      rawCaptureId: input.rawCaptureId,
      captureItemId: input.captureItemId,
      sourceUrl: input.sourceUrl ?? null,
    },
  } satisfies CreateWaitingItemInput);
  if (result.created) {
    logger.info(
      {
        userId: input.userId,
        captureItemId: input.captureItemId,
        waitingItemId: result.item.id,
        status: gate.status,
      },
      "Waiting item created from capture",
    );
  }
  return result;
}

/** Extract the "waiting on <name>" fragment against known people names. */
function waitingStatementPerson(blob: string, peopleNames: string[]): string | null {
  const match = blob.match(/waiting (?:on|for)\s+([A-Za-z][A-Za-z .'-]{1,40})/i);
  if (match) {
    const name = match[1]!.trim().replace(/[.,;:!?].*$/, "").trim();
    if (name.length >= 2) return name.slice(0, 80);
  }
  const lowered = blob.toLowerCase();
  for (const name of peopleNames) {
    if (name.length >= 3 && lowered.includes(name.toLowerCase())) return name;
  }
  return null;
}

/** Enqueue a waiting scan for a note whose content has follow-up language. */
export async function scheduleNoteWaitingScan(
  userId: string,
  noteId: string,
  content: string,
): Promise<void> {
  if (!hasWaitingStatement(content)) return;
  try {
    const { enqueueJob, JOB_TYPE_WAITING_SCAN } = await import("./job-queue");
    const { nudgeJobWorker } = await import("./job-worker");
    await enqueueJob({
      userId,
      type: JOB_TYPE_WAITING_SCAN,
      payload: { noteId },
      id: `wait-note-${noteId}-${Date.now()}`,
    });
    nudgeJobWorker();
  } catch (err) {
    logger.warn({ err, noteId }, "Failed to schedule note waiting scan");
  }
}

/** Note save hook: queue a waiting candidate when the text says so. */
export async function scanNoteForWaitingCandidates(
  userId: string,
  noteId: string,
): Promise<{ scanned: number; created: number }> {
  const { getNoteForUser } = await import("./notes");
  const note = await getNoteForUser(userId, noteId);
  if (!note) return { scanned: 0, created: 0 };
  const text = `${note.title}\n${note.content}`;

  if (await waitingItemExistsForSource(userId, "note", noteId)) {
    return { scanned: 1, created: 0 };
  }

  const { listPeopleForUser } = await import("./people");
  const { listPersonNameAliases, peopleWithAliasNames } = await import(
    "./user-corrections"
  );
  const [peopleRows, aliases] = await Promise.all([
    listPeopleForUser(userId),
    listPersonNameAliases(userId),
  ]);
  const names = peopleWithAliasNames(peopleRows, aliases)
    .map((p) => p.displayName)
    .filter(Boolean);
  const personName = waitingStatementPerson(text, names);
  const ageDays =
    (Date.now() - new Date(note.updatedAt ?? note.createdAt).getTime()) / 86_400_000;

  const candidate = decideNoteWaitingCandidate({
    title: note.title,
    content: note.content,
    personName,
    ageDays: Number.isFinite(ageDays) ? ageDays : 0,
  });
  if (!candidate) return { scanned: 1, created: 0 };

  const ownerPersonId =
    candidate.ownerName !== "Someone"
      ? await personIdForName(userId, candidate.ownerName)
      : null;
  const result = await upsertWaitingItemForUser(userId, {
    ownerName: candidate.ownerName,
    ownerPersonId,
    deliverable: candidate.deliverable,
    promisedAt: new Date(note.updatedAt ?? note.createdAt),
    expectedAt: null,
    dateConfidence: "none",
    confidence: 0.5,
    status: "candidate",
    candidateReason: candidate.reason,
    sourceEntityType: "note",
    sourceEntityId: noteId,
    evidenceText: text.slice(0, 400),
    evidenceSnippet: text.slice(0, 280),
    metadata: { extractedFrom: "note" },
  });
  return { scanned: 1, created: result.created ? 1 : 0 };
}

/**
 * Post-sync sweep: open tasks whose title explicitly mentions waiting become
 * candidates (one per task, capped per run).
 */
export async function scanTaskWaitingCandidates(
  userId: string,
  opts?: { limit?: number },
): Promise<{ scanned: number; created: number }> {
  const limit = opts?.limit ?? 5;
  const rows = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.completed, false)))
    .limit(300);

  let scanned = 0;
  let created = 0;
  for (const task of rows) {
    if (created >= limit) break;
    if (!hasWaitingStatement(task.title)) continue;
    const ageMs = Date.now() - task.updatedAt.getTime();
    if (ageMs < 86_400_000) continue; // give fresh tasks a day
    if (await waitingItemExistsForSource(userId, "task", task.id)) continue;
    scanned += 1;

    let requesterName: string | null = null;
    if (task.requesterPersonId) {
      const r = await getDb()
        .select({ name: people.displayName })
        .from(people)
        .where(and(eq(people.id, task.requesterPersonId), eq(people.userId, userId)))
        .limit(1);
      requesterName = r[0]?.name ?? null;
    }

    const candidate = decideTaskWaitingCandidate({
      title: task.title,
      requesterName,
      personName: null,
      ageDays: ageMs / 86_400_000,
    });
    if (!candidate) continue;

    const result = await upsertWaitingItemForUser(userId, {
      ownerName: candidate.ownerName,
      ownerPersonId: task.requesterPersonId ?? null,
      deliverable: candidate.deliverable,
      promisedAt: task.updatedAt,
      expectedAt: null,
      dateConfidence: "none",
      confidence: 0.5,
      status: "candidate",
      candidateReason: candidate.reason,
      projectId: task.projectId ?? null,
      taskId: task.id,
      sourceEntityType: "task",
      sourceEntityId: task.id,
      evidenceText: `Task: ${task.title}`.slice(0, 400),
      metadata: { extractedFrom: "task" },
    });
    if (result.created) created += 1;
  }
  return { scanned, created };
}
