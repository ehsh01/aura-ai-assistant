import { and, desc, eq } from "drizzle-orm";
import { knowledgeItems, type KnowledgeItem } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newKnowledgeId } from "../lib/recall-format";
import { writeAuditLog } from "./audit";
import { warmEntityEmbedding } from "./embedding-cache";

export type KnowledgeDto = {
  id: string;
  title: string;
  content: string;
  itemType: string;
  tags: string[];
  projectId: string | null;
  sourceCaptureId: string | null;
  createdAt: string;
  updatedAt: string;
};

function toDto(row: KnowledgeItem): KnowledgeDto {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    itemType: row.itemType,
    tags: row.tags ?? [],
    projectId: row.projectId ?? null,
    sourceCaptureId: row.sourceCaptureId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listKnowledgeForUser(userId: string): Promise<KnowledgeDto[]> {
  const rows = await getDb()
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.userId, userId))
    .orderBy(desc(knowledgeItems.updatedAt));
  return rows.map(toDto);
}

export async function createKnowledgeForUser(
  userId: string,
  input: {
    title: string;
    content?: string;
    itemType?: string;
    tags?: string[];
    projectId?: string | null;
    sourceCaptureId?: string | null;
  },
): Promise<KnowledgeDto> {
  const now = new Date();
  const [row] = await getDb()
    .insert(knowledgeItems)
    .values({
      id: newKnowledgeId(),
      userId,
      title: input.title.trim(),
      content: input.content ?? "",
      itemType: input.itemType ?? "note",
      tags: input.tags ?? [],
      projectId: input.projectId ?? null,
      sourceCaptureId: input.sourceCaptureId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const dto = toDto(row!);
  await writeAuditLog({
    userId,
    action: "knowledge_created",
    entityType: "knowledge",
    entityId: dto.id,
    metadata: { title: dto.title, itemType: dto.itemType },
  });
  warmEntityEmbedding(userId, {
    entityType: "knowledge",
    entityId: dto.id,
    text: `${dto.title}\n${dto.content.slice(0, 600)}\ntags=${dto.tags.join(",")}`,
  });
  return dto;
}

export async function getKnowledgeForUser(
  userId: string,
  itemId: string,
): Promise<KnowledgeDto | null> {
  const rows = await getDb()
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.id, itemId), eq(knowledgeItems.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function updateKnowledgeForUser(
  userId: string,
  itemId: string,
  input: {
    title?: string;
    content?: string;
    itemType?: string;
    tags?: string[];
    projectId?: string | null;
  },
): Promise<KnowledgeDto | null> {
  const existing = await getKnowledgeForUser(userId, itemId);
  if (!existing) return null;

  const [row] = await getDb()
    .update(knowledgeItems)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.itemType !== undefined ? { itemType: input.itemType } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(knowledgeItems.id, itemId), eq(knowledgeItems.userId, userId)))
    .returning();

  if (!row) return null;
  const dto = toDto(row);
  warmEntityEmbedding(userId, {
    entityType: "knowledge",
    entityId: dto.id,
    text: `${dto.title}\n${dto.content.slice(0, 600)}\ntags=${dto.tags.join(",")}`,
  });
  return dto;
}
