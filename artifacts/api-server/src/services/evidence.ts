import { and, desc, eq, inArray } from "drizzle-orm";
import { evidence, type Evidence } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newEvidenceId } from "../lib/recall-format";

export type EvidenceDto = {
  id: string;
  entityType: string;
  entityId: string;
  claimType: string;
  sourceCaptureId: string | null;
  sourceRecordId: string | null;
  evidenceText: string | null;
  evidenceMetadata: Record<string, unknown>;
  fileName: string | null;
  fileId: string | null;
  rowNumber: number | null;
  pageNumber: number | null;
  url: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateEvidenceInput = {
  entityType: string;
  entityId: string;
  claimType: string;
  sourceCaptureId?: string | null;
  sourceRecordId?: string | null;
  evidenceText?: string | null;
  evidenceMetadata?: Record<string, unknown>;
  fileName?: string | null;
  fileId?: string | null;
  rowNumber?: number | null;
  pageNumber?: number | null;
  url?: string | null;
};

function toDto(row: Evidence): EvidenceDto {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    claimType: row.claimType,
    sourceCaptureId: row.sourceCaptureId ?? null,
    sourceRecordId: row.sourceRecordId ?? null,
    evidenceText: row.evidenceText ?? null,
    evidenceMetadata: row.evidenceMetadata ?? {},
    fileName: row.fileName ?? null,
    fileId: row.fileId ?? null,
    rowNumber: row.rowNumber ?? null,
    pageNumber: row.pageNumber ?? null,
    url: row.url ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function dedupeEvidenceBySourceClaim<
  T extends { sourceRecordId: string | null; claimType: string },
>(rows: T[]): T[] {
  const seenSourceClaims = new Set<string>();
  return rows.filter((row) => {
    if (!row.sourceRecordId) return true;
    const key = `${row.sourceRecordId}:${row.claimType}`;
    if (seenSourceClaims.has(key)) return false;
    seenSourceClaims.add(key);
    return true;
  });
}

export async function createEvidenceForUser(
  userId: string,
  input: CreateEvidenceInput,
): Promise<EvidenceDto> {
  const now = new Date();
  const [row] = await getDb()
    .insert(evidence)
    .values({
      id: newEvidenceId(),
      userId,
      entityType: input.entityType,
      entityId: input.entityId,
      claimType: input.claimType,
      sourceCaptureId: input.sourceCaptureId ?? null,
      sourceRecordId: input.sourceRecordId ?? null,
      evidenceText: input.evidenceText ?? null,
      evidenceMetadata: input.evidenceMetadata ?? {},
      fileName: input.fileName ?? null,
      fileId: input.fileId ?? null,
      rowNumber: input.rowNumber ?? null,
      pageNumber: input.pageNumber ?? null,
      url: input.url ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toDto(row!);
}

/**
 * Connector syncs are repeatable. Keep one current evidence record per
 * source-record claim instead of appending duplicates on every sync.
 */
export async function upsertEvidenceForSourceRecord(
  userId: string,
  input: CreateEvidenceInput & { sourceRecordId: string },
): Promise<EvidenceDto> {
  const [existing] = await getDb()
    .select()
    .from(evidence)
    .where(
      and(
        eq(evidence.userId, userId),
        eq(evidence.sourceRecordId, input.sourceRecordId),
        eq(evidence.claimType, input.claimType),
      ),
    )
    .orderBy(desc(evidence.updatedAt))
    .limit(1);

  if (!existing) return createEvidenceForUser(userId, input);

  const [row] = await getDb()
    .update(evidence)
    .set({
      entityType: input.entityType,
      entityId: input.entityId,
      sourceCaptureId: input.sourceCaptureId ?? null,
      evidenceText: input.evidenceText ?? null,
      evidenceMetadata: input.evidenceMetadata ?? {},
      fileName: input.fileName ?? null,
      fileId: input.fileId ?? null,
      rowNumber: input.rowNumber ?? null,
      pageNumber: input.pageNumber ?? null,
      url: input.url ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(evidence.id, existing.id), eq(evidence.userId, userId)))
    .returning();
  return toDto(row!);
}

/**
 * Batch the expensive source/claim lookup used by connector pages. Existing
 * duplicate rows are intentionally left untouched; like the single-row path,
 * an update targets only the newest matching row.
 */
export async function upsertEvidenceForSourceRecordsBatch(
  userId: string,
  inputs: Array<
    CreateEvidenceInput & {
      sourceRecordId: string;
      /** Repair missing evidence for hash-skipped rows without rewriting it. */
      insertOnly?: boolean;
    }
  >,
): Promise<void> {
  if (inputs.length === 0) return;
  const sourceRecordIds = [...new Set(inputs.map((input) => input.sourceRecordId))];
  const existingRows = await getDb()
    .selectDistinctOn(
      [evidence.sourceRecordId, evidence.claimType],
      {
        id: evidence.id,
        sourceRecordId: evidence.sourceRecordId,
        claimType: evidence.claimType,
        updatedAt: evidence.updatedAt,
      },
    )
    .from(evidence)
    .where(
      and(
        eq(evidence.userId, userId),
        inArray(evidence.sourceRecordId, sourceRecordIds),
      ),
    )
    .orderBy(
      evidence.sourceRecordId,
      evidence.claimType,
      desc(evidence.updatedAt),
    );

  const newestBySourceClaim = new Map<
    string,
    (typeof existingRows)[number]
  >();
  for (const row of existingRows) {
    if (!row.sourceRecordId) continue;
    const key = `${row.sourceRecordId}\0${row.claimType}`;
    if (!newestBySourceClaim.has(key)) newestBySourceClaim.set(key, row);
  }

  for (const input of inputs) {
    const key = `${input.sourceRecordId}\0${input.claimType}`;
    const existing = newestBySourceClaim.get(key);
    if (!existing) {
      await createEvidenceForUser(userId, input);
      continue;
    }
    if (input.insertOnly) continue;
    await getDb()
      .update(evidence)
      .set({
        entityType: input.entityType,
        entityId: input.entityId,
        sourceCaptureId: input.sourceCaptureId ?? null,
        evidenceText: input.evidenceText ?? null,
        evidenceMetadata: input.evidenceMetadata ?? {},
        fileName: input.fileName ?? null,
        fileId: input.fileId ?? null,
        rowNumber: input.rowNumber ?? null,
        pageNumber: input.pageNumber ?? null,
        url: input.url ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(evidence.id, existing.id), eq(evidence.userId, userId)));
  }
}

export async function getEvidenceForUser(
  userId: string,
  evidenceId: string,
): Promise<EvidenceDto | null> {
  const rows = await getDb()
    .select()
    .from(evidence)
    .where(and(eq(evidence.id, evidenceId), eq(evidence.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function listEvidenceForEntity(
  userId: string,
  entityType: string,
  entityId: string,
): Promise<EvidenceDto[]> {
  const rows = await getDb()
    .select()
    .from(evidence)
    .where(
      and(
        eq(evidence.userId, userId),
        eq(evidence.entityType, entityType),
        eq(evidence.entityId, entityId),
      ),
    )
    .orderBy(desc(evidence.updatedAt));

  return dedupeEvidenceBySourceClaim(rows).map(toDto);
}
