import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { auditLog, waitingItems, type WaitingItem } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newWaitingItemId } from "../lib/recall-format";
import {
  dueAtFromDateString,
  resolveSnoozeUntil,
  type SnoozePreset,
} from "./attention";
import { createEvidenceForUser } from "./evidence";
import { writeAuditLog } from "./audit";

export type WaitingStatus = "candidate" | "open" | "snoozed" | "completed" | "dismissed";
export type WaitingOutcome =
  | "completed"
  | "revised_delayed"
  | "still_waiting"
  | "unclear";
export type DateConfidence = "certain" | "uncertain" | "none";
export type WaitingDueReason = "needs_review" | "follow_up_due" | "expected_overdue";

/** A reply strongly suggests the commitment is done; the user must confirm. */
export type WaitingResolutionSuggestion = {
  outcome: "completed";
  reason: string;
  replySourceRecordId: string | null;
  confidence: number;
  at: string;
};

export const WAITING_DEFAULT_FOLLOWUP_DAYS = 3;

export type WaitingItemDto = {
  id: string;
  ownerPersonId: string | null;
  ownerName: string;
  ownerOrg: string | null;
  deliverable: string;
  promisedAt: string | null;
  expectedAt: string | null;
  dateConfidence: DateConfidence;
  status: WaitingStatus;
  followUpAt: string | null;
  snoozedUntil: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  lastOutcome: WaitingOutcome | null;
  lastReplySourceRecordId: string | null;
  confidence: number;
  threadId: string | null;
  sourceEntityType: string;
  sourceEntityId: string;
  projectId: string | null;
  taskId: string | null;
  needsReview: boolean;
  /** Why Aura flagged an unconfirmed candidate. */
  candidateReason: string | null;
  suggestedResolution: WaitingResolutionSuggestion | null;
  metadata: Record<string, unknown>;
  href: string;
  createdAt: string;
  updatedAt: string;
};

export type WaitingDueItemDto = WaitingItemDto & { dueReason: WaitingDueReason };

export type WaitingItemPatch = {
  ownerName?: string | null;
  ownerOrg?: string | null;
  ownerPersonId?: string | null;
  deliverable?: string | null;
  promisedAt?: string | null;
  expectedAt?: string | null;
  dateConfidence?: string | null;
  followUpAt?: string | null;
  threadId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
};

const DATE_CONFIDENCES = new Set<DateConfidence>(["certain", "uncertain", "none"]);

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

const FINGERPRINT_STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "for", "and", "or", "on", "in", "at", "by",
  "with", "from", "my", "me", "your", "you", "we", "our", "us", "please",
  "will", "would", "can", "could", "should", "i", "ll", "be", "is", "it",
]);

function normalizeFingerprintPart(text: string, maxLen: number): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !FINGERPRINT_STOPWORDS.has(t));
  return tokens.join(" ").slice(0, maxLen).trim();
}

/** Stable dedupe key: normalized owner name + deliverable. */
export function waitingFingerprint(ownerName: string, deliverable: string): string {
  const owner = normalizeFingerprintPart(ownerName, 80);
  const what = normalizeFingerprintPart(deliverable, 180);
  return `${owner}|${what}`.slice(0, 300);
}

const TRANSITIONS: Record<WaitingStatus, WaitingStatus[]> = {
  candidate: ["open", "snoozed", "dismissed"],
  open: ["snoozed", "completed", "dismissed"],
  snoozed: ["open", "completed", "dismissed"],
  completed: ["open"],
  dismissed: ["open"],
};

/** Guard for status transitions; completed/dismissed are terminal but reopenable. */
export function canTransitionWaitingStatus(
  from: WaitingStatus,
  to: WaitingStatus,
): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Default next follow-up: the expected date when it is certain; otherwise the
 * promise date + 3 days, flagged uncertain. Never invents a deadline.
 */
export function defaultFollowUpAt(input: {
  promisedAt: Date | null;
  expectedAt: Date | null;
  dateConfidence: DateConfidence;
  now?: Date;
}): { at: Date; uncertain: boolean } {
  const now = input.now ?? new Date();
  if (input.expectedAt && input.dateConfidence === "certain") {
    return { at: input.expectedAt, uncertain: false };
  }
  const base = input.promisedAt ?? now;
  return {
    at: new Date(base.getTime() + WAITING_DEFAULT_FOLLOWUP_DAYS * 86_400_000),
    uncertain: true,
  };
}

/** Why a durable waiting item belongs on Today right now, or null. */
export function waitingDueReason(
  item: Pick<WaitingItem, "status" | "followUpAt" | "expectedAt" | "metadata">,
  now: Date = new Date(),
): WaitingDueReason | null {
  if (item.status !== "open") return null;
  if (item.metadata?.needsReview === true) return "needs_review";
  const t = now.getTime();
  if (item.followUpAt && item.followUpAt.getTime() <= t) return "follow_up_due";
  if (item.expectedAt && item.expectedAt.getTime() <= t) return "expected_overdue";
  return null;
}

export function isWaitingDue(
  item: Pick<WaitingItem, "status" | "followUpAt" | "expectedAt" | "metadata">,
  now: Date = new Date(),
): boolean {
  return waitingDueReason(item, now) !== null;
}

/** Next follow-up after the user sent one (default +3d, clamped 1..30). */
export function computeNextFollowUpAt(now: Date, days?: number): Date {
  const d = Math.min(Math.max(days ?? WAITING_DEFAULT_FOLLOWUP_DAYS, 1), 30);
  return new Date(now.getTime() + d * 86_400_000);
}

/** Validate + normalize a user correction patch. Throws on invalid input. */
export function validateWaitingPatch(patch: WaitingItemPatch): {
  ownerName?: string;
  ownerOrg?: string | null;
  ownerPersonId?: string | null;
  deliverable?: string;
  promisedAt?: Date | null;
  expectedAt?: Date | null;
  dateConfidence?: DateConfidence;
  followUpAt?: Date | null;
  threadId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
} {
  const out: ReturnType<typeof validateWaitingPatch> = {};
  if (patch.ownerName !== undefined) {
    const v = (patch.ownerName ?? "").trim().slice(0, 200);
    if (!v) throw new Error("ownerName cannot be empty");
    out.ownerName = v;
  }
  if (patch.ownerOrg !== undefined) {
    const v = (patch.ownerOrg ?? "").trim().slice(0, 200);
    out.ownerOrg = v || null;
  }
  if (patch.ownerPersonId !== undefined) {
    const v = (patch.ownerPersonId ?? "").trim().slice(0, 64);
    out.ownerPersonId = v || null;
  }
  if (patch.deliverable !== undefined) {
    const v = (patch.deliverable ?? "").trim().slice(0, 2000);
    if (!v) throw new Error("deliverable cannot be empty");
    out.deliverable = v;
  }
  if (patch.promisedAt !== undefined) {
    out.promisedAt = patch.promisedAt ? dueAtFromDateString(patch.promisedAt) : null;
    if (patch.promisedAt && !out.promisedAt) throw new Error("promisedAt is not a valid date");
  }
  if (patch.expectedAt !== undefined) {
    out.expectedAt = patch.expectedAt ? dueAtFromDateString(patch.expectedAt) : null;
    if (patch.expectedAt && !out.expectedAt) throw new Error("expectedAt is not a valid date");
  }
  if (patch.dateConfidence !== undefined) {
    const v = (patch.dateConfidence ?? "none") as DateConfidence;
    if (!DATE_CONFIDENCES.has(v)) throw new Error("dateConfidence must be certain|uncertain|none");
    out.dateConfidence = v;
  }
  if (patch.followUpAt !== undefined) {
    out.followUpAt = patch.followUpAt ? dueAtFromDateString(patch.followUpAt) : null;
    if (patch.followUpAt && !out.followUpAt) throw new Error("followUpAt is not a valid date");
  }
  if (patch.threadId !== undefined) {
    const v = (patch.threadId ?? "").trim().slice(0, 128);
    out.threadId = v || null;
  }
  if (patch.projectId !== undefined) {
    const v = (patch.projectId ?? "").trim().slice(0, 64);
    out.projectId = v || null;
  }
  if (patch.taskId !== undefined) {
    const v = (patch.taskId ?? "").trim().slice(0, 64);
    out.taskId = v || null;
  }
  return out;
}

/** Read the resolution suggestion a reply classification left for review. */
export function suggestedResolutionFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): WaitingResolutionSuggestion | null {
  const raw = metadata?.suggestedResolution;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.outcome !== "completed") return null;
  return {
    outcome: "completed",
    reason: typeof r.reason === "string" ? r.reason : "",
    replySourceRecordId: typeof r.replySourceRecordId === "string" ? r.replySourceRecordId : null,
    confidence: typeof r.confidence === "number" ? r.confidence : 0,
    at: typeof r.at === "string" ? r.at : "",
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function toDto(row: WaitingItem): WaitingItemDto {
  return {
    id: row.id,
    ownerPersonId: row.ownerPersonId ?? null,
    ownerName: row.ownerName,
    ownerOrg: row.ownerOrg ?? null,
    deliverable: row.deliverable,
    promisedAt: row.promisedAt?.toISOString() ?? null,
    expectedAt: row.expectedAt?.toISOString() ?? null,
    dateConfidence: (row.dateConfidence as DateConfidence) || "none",
    status: (row.status as WaitingStatus) || "open",
    followUpAt: row.followUpAt?.toISOString() ?? null,
    snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    lastOutcome: (row.lastOutcome as WaitingOutcome) ?? null,
    lastReplySourceRecordId: row.lastReplySourceRecordId ?? null,
    confidence: row.confidence,
    threadId: row.threadId ?? null,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    projectId: row.projectId ?? null,
    taskId: row.taskId ?? null,
    needsReview: row.metadata?.needsReview === true,
    candidateReason:
      typeof row.metadata?.candidateReason === "string"
        ? row.metadata.candidateReason
        : null,
    suggestedResolution: suggestedResolutionFromMetadata(row.metadata),
    metadata: row.metadata ?? {},
    href: `/waiting/${row.id}`,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findActiveByFingerprint(
  userId: string,
  fingerprint: string,
): Promise<WaitingItem | null> {
  const rows = await getDb()
    .select()
    .from(waitingItems)
    .where(
      and(
        eq(waitingItems.userId, userId),
        eq(waitingItems.fingerprint, fingerprint),
        inArray(waitingItems.status, ["open", "snoozed", "candidate"]),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export type CreateWaitingItemInput = {
  ownerName: string;
  ownerOrg?: string | null;
  ownerPersonId?: string | null;
  deliverable: string;
  promisedAt?: Date | null;
  expectedAt?: Date | null;
  dateConfidence?: DateConfidence;
  followUpAt?: Date | null;
  confidence?: number;
  threadId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  /** "candidate" parks the item in the review queue instead of opening it. */
  status?: "open" | "candidate";
  /** Plain-language reason Aura believes a follow-up is needed. */
  candidateReason?: string | null;
  sourceEntityType: string;
  sourceEntityId: string;
  /** Evidence linking the commitment to its source; written when provided. */
  evidenceText?: string | null;
  evidenceSnippet?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * evidence.source_capture_id references raw captures, but capture-originated
 * waiting items point at the capture_items inbox row — the raw id rides along
 * in metadata so the evidence FK stays valid.
 */
function evidenceCaptureId(input: CreateWaitingItemInput): string | null {
  if (input.sourceEntityType !== "capture_item") return null;
  const raw = input.metadata?.rawCaptureId;
  return typeof raw === "string" && raw ? raw : null;
}

/**
 * Create a durable waiting item, or return the existing active commitment with
 * the same fingerprint (dedupe). Extraction re-runs never clobber user
 * corrections — a dedupe hit only links new evidence.
 */
export async function upsertWaitingItemForUser(
  userId: string,
  input: CreateWaitingItemInput,
): Promise<{ item: WaitingItemDto; created: boolean }> {
  const ownerName = input.ownerName.trim().slice(0, 200);
  const deliverable = input.deliverable.trim().slice(0, 2000);
  if (!ownerName || !deliverable) {
    throw new Error("ownerName and deliverable are required");
  }
  const fingerprint = waitingFingerprint(ownerName, deliverable);

  const existing = await findActiveByFingerprint(userId, fingerprint);
  if (existing) {
    if (input.evidenceText) {
      await createEvidenceForUser(userId, {
        entityType: "waiting_item",
        entityId: existing.id,
        claimType: "waiting_commitment",
        sourceRecordId:
          input.sourceEntityType === "source_record" ? input.sourceEntityId : null,
        sourceCaptureId: evidenceCaptureId(input),
        evidenceText: input.evidenceText,
        evidenceMetadata: {
          sourceUrl: input.metadata?.sourceUrl ?? null,
          threadId: input.threadId ?? null,
        },
      });
    }
    return { item: toDto(existing), created: false };
  }

  const now = new Date();
  const dateConfidence = input.dateConfidence ?? (input.expectedAt ? "uncertain" : "none");
  const followUp =
    input.followUpAt ??
    defaultFollowUpAt({
      promisedAt: input.promisedAt ?? null,
      expectedAt: input.expectedAt ?? null,
      dateConfidence,
      now,
    }).at;

  const id = newWaitingItemId();
  const [row] = await getDb()
    .insert(waitingItems)
    .values({
      id,
      userId,
      ownerPersonId: input.ownerPersonId ?? null,
      ownerName,
      ownerOrg: input.ownerOrg?.trim().slice(0, 200) || null,
      deliverable,
      promisedAt: input.promisedAt ?? null,
      expectedAt: input.expectedAt ?? null,
      dateConfidence,
      status: input.status ?? "open",
      followUpAt: followUp,
      confidence: Math.min(1, Math.max(0, input.confidence ?? 0.5)),
      fingerprint,
      threadId: input.threadId ?? null,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.candidateReason
          ? { candidateReason: input.candidateReason.slice(0, 300) }
          : {}),
        ...(input.evidenceSnippet
          ? { evidenceSnippet: input.evidenceSnippet.slice(0, 500) }
          : {}),
      },
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (input.evidenceText) {
    await createEvidenceForUser(userId, {
      entityType: "waiting_item",
      entityId: id,
      claimType: "waiting_commitment",
      sourceRecordId:
        input.sourceEntityType === "source_record" ? input.sourceEntityId : null,
      sourceCaptureId: evidenceCaptureId(input),
      evidenceText: input.evidenceText,
      evidenceMetadata: {
        sourceUrl: input.metadata?.sourceUrl ?? null,
        threadId: input.threadId ?? null,
      },
    });
  }
  await writeAuditLog({
    userId,
    action:
      input.status === "candidate" ? "waiting_candidate_created" : "waiting_item_created",
    entityType: "waiting_item",
    entityId: id,
    metadata: {
      ownerName,
      deliverable: deliverable.slice(0, 200),
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      dateConfidence,
      ...(input.candidateReason
        ? { candidateReason: input.candidateReason.slice(0, 300) }
        : {}),
    },
  });
  return { item: toDto(row!), created: true };
}

export async function listWaitingItemsForUser(
  userId: string,
  opts?: { status?: WaitingStatus | "active" | "all"; limit?: number },
): Promise<WaitingItemDto[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 200);
  const status = opts?.status ?? "active";
  const where =
    status === "all"
      ? eq(waitingItems.userId, userId)
      : status === "active"
        ? and(eq(waitingItems.userId, userId), inArray(waitingItems.status, ["open", "snoozed"]))
        : and(eq(waitingItems.userId, userId), eq(waitingItems.status, status));
  const rows = await getDb()
    .select()
    .from(waitingItems)
    .where(where)
    .orderBy(desc(waitingItems.updatedAt))
    .limit(limit);
  return rows.map(toDto);
}

/** Items that belong on Today right now (wakes expired snoozes first). */
export async function listWaitingDueForUser(
  userId: string,
  now: Date = new Date(),
  limit = 40,
): Promise<WaitingDueItemDto[]> {
  await getDb()
    .update(waitingItems)
    .set({ status: "open", snoozedUntil: null, updatedAt: now })
    .where(
      and(
        eq(waitingItems.userId, userId),
        eq(waitingItems.status, "snoozed"),
        lte(waitingItems.snoozedUntil, now),
      ),
    );

  const rows = await getDb()
    .select()
    .from(waitingItems)
    .where(and(eq(waitingItems.userId, userId), eq(waitingItems.status, "open")))
    .orderBy(asc(waitingItems.followUpAt))
    .limit(200);

  return rows
    .map((row) => {
      const reason = waitingDueReason(row, now);
      return reason ? { ...toDto(row), dueReason: reason } : null;
    })
    .filter((x): x is WaitingDueItemDto => x !== null)
    .slice(0, limit);
}

export async function getWaitingItemForUser(
  userId: string,
  id: string,
): Promise<WaitingItemDto | null> {
  const rows = await getDb()
    .select()
    .from(waitingItems)
    .where(and(eq(waitingItems.id, id), eq(waitingItems.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

async function getRow(userId: string, id: string): Promise<WaitingItem | null> {
  const rows = await getDb()
    .select()
    .from(waitingItems)
    .where(and(eq(waitingItems.id, id), eq(waitingItems.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** User corrections to any extracted field; recomputes fingerprint when needed. */
export async function patchWaitingItemForUser(
  userId: string,
  id: string,
  patch: WaitingItemPatch,
): Promise<WaitingItemDto | null> {
  const prev = await getRow(userId, id);
  if (!prev) return null;
  const validated = validateWaitingPatch(patch);
  if (Object.keys(validated).length === 0) return toDto(prev);

  const nextOwner = validated.ownerName ?? prev.ownerName;
  const nextDeliverable = validated.deliverable ?? prev.deliverable;
  const fingerprintChanged =
    nextOwner !== prev.ownerName || nextDeliverable !== prev.deliverable;

  const now = new Date();
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(validated)) {
    const before = (prev as unknown as Record<string, unknown>)[key];
    const beforeIso = before instanceof Date ? before.toISOString() : before;
    const afterIso = value instanceof Date ? value.toISOString() : value;
    if (beforeIso !== afterIso) {
      changes[key] = { from: beforeIso ?? null, to: afterIso ?? null };
    }
  }
  if (Object.keys(changes).length === 0 && !fingerprintChanged) return toDto(prev);

  const [row] = await getDb()
    .update(waitingItems)
    .set({
      ...validated,
      ...(fingerprintChanged
        ? { fingerprint: waitingFingerprint(nextOwner, nextDeliverable) }
        : {}),
      updatedAt: now,
    })
    .where(eq(waitingItems.id, prev.id))
    .returning();

  await writeAuditLog({
    userId,
    action: "waiting_item_updated",
    entityType: "waiting_item",
    entityId: prev.id,
    metadata: { changes },
  });
  return row ? toDto(row) : null;
}

async function transition(
  userId: string,
  id: string,
  to: WaitingStatus,
  auditAction: string,
  extra?: Record<string, unknown>,
): Promise<WaitingItemDto | null> {
  const prev = await getRow(userId, id);
  if (!prev) return null;
  const from = (prev.status as WaitingStatus) || "open";
  if (!canTransitionWaitingStatus(from, to)) return toDto(prev);

  const now = new Date();
  const [row] = await getDb()
    .update(waitingItems)
    .set({
      status: to,
      ...(to === "completed" ? { completedAt: now } : {}),
      ...(to === "dismissed" ? { dismissedAt: now } : {}),
      ...(to === "open"
        ? { completedAt: null, dismissedAt: null, snoozedUntil: null }
        : {}),
      updatedAt: now,
      ...(extra ?? {}),
    })
    .where(eq(waitingItems.id, prev.id))
    .returning();

  await writeAuditLog({
    userId,
    action: auditAction,
    entityType: "waiting_item",
    entityId: prev.id,
    metadata: { from, to, ownerName: prev.ownerName },
  });
  return row ? toDto(row) : null;
}

export async function snoozeWaitingItem(
  userId: string,
  id: string,
  input: { until?: string | null; preset?: SnoozePreset | null },
): Promise<WaitingItemDto | null> {
  const prev = await getRow(userId, id);
  if (!prev) return null;
  const from = (prev.status as WaitingStatus) || "open";
  if (!canTransitionWaitingStatus(from, "snoozed")) return toDto(prev);

  const anchor = prev.followUpAt ?? prev.expectedAt ?? new Date();
  let until: Date | null = null;
  if (input.until) {
    until = new Date(input.until);
    if (Number.isNaN(until.getTime())) until = null;
  }
  if (!until && input.preset) {
    until = resolveSnoozeUntil(anchor, input.preset);
  }
  if (!until) {
    until = resolveSnoozeUntil(anchor, "3d");
  }

  const now = new Date();
  const [row] = await getDb()
    .update(waitingItems)
    .set({ status: "snoozed", snoozedUntil: until, updatedAt: now })
    .where(eq(waitingItems.id, prev.id))
    .returning();

  await writeAuditLog({
    userId,
    action: "waiting_item_snoozed",
    entityType: "waiting_item",
    entityId: prev.id,
    metadata: { from, snoozedUntil: until.toISOString() },
  });
  return row ? toDto(row) : null;
}

export async function dismissWaitingItem(userId: string, id: string) {
  return transition(userId, id, "dismissed", "waiting_item_dismissed");
}

/** User confirms a review-queue candidate; it becomes a tracked commitment. */
export async function confirmWaitingCandidate(
  userId: string,
  id: string,
): Promise<WaitingItemDto | null> {
  const prev = await getRow(userId, id);
  if (!prev) return null;
  const metadata = { ...(prev.metadata ?? {}) };
  delete metadata.candidateReason;
  return transition(userId, id, "open", "waiting_candidate_confirmed", { metadata });
}

export async function completeWaitingItem(userId: string, id: string) {
  const prev = await getRow(userId, id);
  if (!prev) return null;
  const metadata = { ...(prev.metadata ?? {}) };
  delete metadata.needsReview;
  delete metadata.suggestedResolution;
  return transition(userId, id, "completed", "waiting_item_completed", { metadata });
}

export async function reopenWaitingItem(userId: string, id: string) {
  return transition(userId, id, "open", "waiting_item_reopened");
}

/** Advance followUpAt after the user sent a follow-up (default +3d). */
export async function advanceWaitingFollowUp(
  userId: string,
  id: string,
  opts?: { days?: number; outcome?: WaitingOutcome | null },
): Promise<WaitingItemDto | null> {
  const prev = await getRow(userId, id);
  if (!prev) return null;
  const days = Math.min(Math.max(opts?.days ?? WAITING_DEFAULT_FOLLOWUP_DAYS, 1), 30);
  const now = new Date();
  const next = computeNextFollowUpAt(now, days);
  const metadata = { ...(prev.metadata ?? {}) };
  delete metadata.needsReview;
  delete metadata.suggestedResolution;
  const [row] = await getDb()
    .update(waitingItems)
    .set({
      followUpAt: next,
      ...(opts?.outcome !== undefined ? { lastOutcome: opts.outcome } : {}),
      metadata,
      updatedAt: now,
    })
    .where(eq(waitingItems.id, prev.id))
    .returning();
  return row ? toDto(row) : null;
}

/** Audit timeline for the detail view (newest first). */
export async function listWaitingAuditForItem(
  userId: string,
  id: string,
  limit = 50,
): Promise<
  { id: string; action: string; metadata: Record<string, unknown>; createdAt: string }[]
> {
  const rows = await getDb()
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.userId, userId),
        eq(auditLog.entityType, "waiting_item"),
        eq(auditLog.entityId, id),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt.toISOString(),
  }));
}
