import { and, desc, eq } from "drizzle-orm";
import { documents, type Document } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newDocumentId } from "../lib/recall-format";
import { writeAuditLog } from "./audit";
import { warmEntityEmbedding } from "./embedding-cache";

export type DocumentDto = {
  id: string;
  fileName: string;
  fileType: string | null;
  storagePath: string | null;
  sourceCaptureId: string | null;
  extractedText: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  uploadedAt: string;
  createdAt: string;
  updatedAt: string;
};

function toDto(row: Document): DocumentDto {
  return {
    id: row.id,
    fileName: row.fileName,
    fileType: row.fileType ?? null,
    storagePath: row.storagePath ?? null,
    sourceCaptureId: row.sourceCaptureId ?? null,
    extractedText: row.extractedText ?? null,
    summary: row.summary ?? null,
    metadata: row.metadata ?? {},
    uploadedAt: row.uploadedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listDocumentsForUser(userId: string): Promise<DocumentDto[]> {
  const rows = await getDb()
    .select()
    .from(documents)
    .where(eq(documents.userId, userId))
    .orderBy(desc(documents.uploadedAt));
  return rows.map(toDto);
}

export async function createDocumentForUser(
  userId: string,
  input: {
    fileName: string;
    fileType?: string | null;
    storagePath?: string | null;
    sourceCaptureId?: string | null;
    extractedText?: string | null;
    summary?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<DocumentDto> {
  const now = new Date();
  const [row] = await getDb()
    .insert(documents)
    .values({
      id: newDocumentId(),
      userId,
      fileName: input.fileName,
      fileType: input.fileType ?? null,
      storagePath: input.storagePath ?? null,
      sourceCaptureId: input.sourceCaptureId ?? null,
      extractedText: input.extractedText ?? null,
      summary: input.summary ?? null,
      metadata: input.metadata ?? {},
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const dto = toDto(row!);
  await writeAuditLog({
    userId,
    action: "document_created",
    entityType: "document",
    entityId: dto.id,
    metadata: { fileName: dto.fileName },
  });
  warmEntityEmbedding(userId, {
    entityType: "document",
    entityId: dto.id,
    text: `${dto.fileName}\n${(dto.summary ?? dto.extractedText ?? "").slice(0, 600)}`,
  });
  return dto;
}

export async function getDocumentForUser(
  userId: string,
  documentId: string,
): Promise<DocumentDto | null> {
  const rows = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}
