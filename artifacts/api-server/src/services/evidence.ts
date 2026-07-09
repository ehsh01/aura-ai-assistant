import { and, eq } from "drizzle-orm";
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
    );
  return rows.map(toDto);
}
