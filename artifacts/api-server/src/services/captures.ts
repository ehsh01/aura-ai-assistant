import { and, desc, eq } from "drizzle-orm";
import { captures, type Capture } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newRawCaptureId } from "../lib/recall-format";

/**
 * CaptureService — the raw Capture Layer.
 *
 * Responsibilities (docs/01_Architecture.md, docs/03_Data_Model.md):
 *  - Store raw incoming input immutably, before any AI processing.
 *  - Track a processing lifecycle so downstream (Phase 2) extraction can run
 *    asynchronously without blocking capture.
 *  - Never overwrite raw source data (docs/02_Cursor_Rules.md Rule 1 & 6).
 *
 * Business logic lives here, not in routes (Rule 7). All functions are scoped
 * by userId so a user can only ever touch their own captures.
 */

export const CAPTURE_PROCESSED_STATUSES = [
  "pending",
  "processing",
  "processed",
  "failed",
  "ignored",
  "archived",
] as const;

export type CaptureProcessedStatus = (typeof CAPTURE_PROCESSED_STATUSES)[number];

/**
 * Allowed processing-status transitions. Kept intentionally small and explicit
 * so the lifecycle is auditable. Raw payload fields are NOT part of this map —
 * they are immutable and have no transition.
 */
const STATUS_TRANSITIONS: Record<CaptureProcessedStatus, CaptureProcessedStatus[]> = {
  pending: ["processing", "ignored", "archived"],
  processing: ["processed", "failed", "pending", "archived"],
  processed: ["archived"],
  failed: ["processing", "pending", "ignored", "archived"],
  ignored: ["pending", "archived"],
  archived: ["pending"],
};

export function isCaptureProcessedStatus(value: unknown): value is CaptureProcessedStatus {
  return (
    typeof value === "string" &&
    (CAPTURE_PROCESSED_STATUSES as readonly string[]).includes(value)
  );
}

/** Pure guard: is a lifecycle transition allowed? A no-op (same status) is allowed. */
export function canTransitionCaptureStatus(
  from: CaptureProcessedStatus,
  to: CaptureProcessedStatus,
): boolean {
  if (from === to) return true;
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export type RecallCaptureDto = {
  id: string;
  sourceType: string;
  sourceName: string | null;
  sourceUrl: string | null;
  title: string | null;
  rawText: string;
  rawHtml: string | null;
  rawMetadata: Record<string, unknown>;
  processedStatus: CaptureProcessedStatus;
  processingError: string | null;
  capturedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateCaptureInput = {
  rawText: string;
  sourceType?: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  rawHtml?: string | null;
  rawMetadata?: Record<string, unknown>;
  capturedAt?: string;
};

/** Only the mutable, non-source fields may be changed after creation. */
export type UpdateCaptureStatusInput = {
  processedStatus?: CaptureProcessedStatus;
  processingError?: string | null;
  title?: string | null;
};

export type ListCapturesInput = {
  status?: CaptureProcessedStatus;
  limit?: number;
};

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/** Fall back to the first non-empty line so captures always have a human label. */
function deriveTitle(rawText: string, provided?: string | null): string | null {
  if (provided && provided.trim()) {
    const trimmed = provided.trim();
    return trimmed.length > 500 ? trimmed.slice(0, 500) : trimmed;
  }
  const firstLine = rawText.trim().split(/\r?\n/).find(Boolean);
  if (!firstLine) return null;
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
}

export function toCaptureDto(row: Capture): RecallCaptureDto {
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceName: row.sourceName ?? null,
    sourceUrl: row.sourceUrl ?? null,
    title: row.title ?? null,
    rawText: row.rawText,
    rawHtml: row.rawHtml ?? null,
    rawMetadata: row.rawMetadata ?? {},
    processedStatus: isCaptureProcessedStatus(row.processedStatus)
      ? row.processedStatus
      : "pending",
    processingError: row.processingError ?? null,
    capturedAt: row.capturedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Store a raw capture. Deliberately does NOT run AI — raw is persisted first and
 * always lands as `pending` for later (Phase 2) asynchronous extraction.
 */
export async function createCaptureForUser(
  userId: string,
  input: CreateCaptureInput,
): Promise<RecallCaptureDto> {
  const now = new Date();
  const capturedAt = input.capturedAt ? new Date(input.capturedAt) : now;
  const [row] = await getDb()
    .insert(captures)
    .values({
      id: newRawCaptureId(),
      userId,
      sourceType: input.sourceType?.trim() || "manual",
      sourceName: input.sourceName ?? null,
      sourceUrl: input.sourceUrl ?? null,
      title: deriveTitle(input.rawText, input.title),
      rawText: input.rawText,
      rawHtml: input.rawHtml ?? null,
      rawMetadata: input.rawMetadata ?? {},
      processedStatus: "pending",
      processingError: null,
      capturedAt: Number.isNaN(capturedAt.getTime()) ? now : capturedAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return toCaptureDto(row!);
}

export async function listCapturesForUser(
  userId: string,
  input: ListCapturesInput = {},
): Promise<RecallCaptureDto[]> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const where = input.status
    ? and(eq(captures.userId, userId), eq(captures.processedStatus, input.status))
    : eq(captures.userId, userId);

  const rows = await getDb()
    .select()
    .from(captures)
    .where(where)
    .orderBy(desc(captures.capturedAt))
    .limit(limit);
  return rows.map(toCaptureDto);
}

export async function getCaptureForUser(
  userId: string,
  captureId: string,
): Promise<RecallCaptureDto | null> {
  const rows = await getDb()
    .select()
    .from(captures)
    .where(and(eq(captures.id, captureId), eq(captures.userId, userId)))
    .limit(1);
  return rows[0] ? toCaptureDto(rows[0]) : null;
}

export class CaptureStatusTransitionError extends Error {
  constructor(
    readonly from: CaptureProcessedStatus,
    readonly to: CaptureProcessedStatus,
  ) {
    super(`Cannot transition capture from '${from}' to '${to}'`);
    this.name = "CaptureStatusTransitionError";
  }
}

/**
 * Update only the mutable lifecycle fields. Raw source fields (rawText/rawHtml/
 * rawMetadata/sourceType/sourceUrl/sourceName) are intentionally unreachable
 * here — they can never be mutated after creation.
 */
export async function updateCaptureStatusForUser(
  userId: string,
  captureId: string,
  input: UpdateCaptureStatusInput,
): Promise<RecallCaptureDto | null> {
  const existing = await getCaptureForUser(userId, captureId);
  if (!existing) return null;

  if (input.processedStatus && !canTransitionCaptureStatus(existing.processedStatus, input.processedStatus)) {
    throw new CaptureStatusTransitionError(existing.processedStatus, input.processedStatus);
  }

  const [row] = await getDb()
    .update(captures)
    .set({
      ...(input.processedStatus !== undefined ? { processedStatus: input.processedStatus } : {}),
      ...(input.processingError !== undefined ? { processingError: input.processingError } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(captures.id, captureId), eq(captures.userId, userId)))
    .returning();

  return row ? toCaptureDto(row) : null;
}
