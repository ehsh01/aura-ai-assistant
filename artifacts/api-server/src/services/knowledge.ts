import { and, desc, eq } from "drizzle-orm";
import { knowledgeItems, type KnowledgeItem } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newKnowledgeId } from "../lib/recall-format";
import { writeAuditLog } from "./audit";
import { warmEntityEmbedding } from "./embedding-cache";
import {
  personNamesById,
  resolvePersonIdFromTags,
  syncPersonTag,
} from "./person-tags";

export type KnowledgeDto = {
  id: string;
  title: string;
  content: string;
  itemType: string;
  tags: string[];
  projectId: string | null;
  primaryPersonId: string | null;
  primaryPersonName: string | null;
  sourceCaptureId: string | null;
  createdAt: string;
  updatedAt: string;
};

function toDto(row: KnowledgeItem, personName: string | null = null): KnowledgeDto {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    itemType: row.itemType,
    tags: row.tags ?? [],
    projectId: row.projectId ?? null,
    primaryPersonId: row.primaryPersonId ?? null,
    primaryPersonName: personName,
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
  const names = await personNamesById(
    userId,
    rows.map((r) => r.primaryPersonId).filter((id): id is string => Boolean(id)),
  );
  return rows.map((row) =>
    toDto(row, row.primaryPersonId ? names.get(row.primaryPersonId) ?? null : null),
  );
}

export async function createKnowledgeForUser(
  userId: string,
  input: {
    title: string;
    content?: string;
    itemType?: string;
    tags?: string[];
    projectId?: string | null;
    primaryPersonId?: string | null;
    sourceCaptureId?: string | null;
  },
): Promise<KnowledgeDto> {
  let tags = [...(input.tags ?? [])];
  let primaryPersonId: string | null;
  if (input.primaryPersonId === null) {
    primaryPersonId = null;
    tags = syncPersonTag(tags, null);
  } else if (input.primaryPersonId) {
    primaryPersonId = input.primaryPersonId;
  } else {
    primaryPersonId = await resolvePersonIdFromTags(userId, tags);
  }
  let personName: string | null = null;
  if (primaryPersonId) {
    const names = await personNamesById(userId, [primaryPersonId]);
    personName = names.get(primaryPersonId) ?? null;
    if (personName) tags = syncPersonTag(tags, personName);
  }

  const now = new Date();
  const [row] = await getDb()
    .insert(knowledgeItems)
    .values({
      id: newKnowledgeId(),
      userId,
      title: input.title.trim(),
      content: input.content ?? "",
      itemType: input.itemType ?? "note",
      tags,
      projectId: input.projectId ?? null,
      primaryPersonId,
      sourceCaptureId: input.sourceCaptureId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const dto = toDto(row!, personName);
  await writeAuditLog({
    userId,
    action: "knowledge_created",
    entityType: "knowledge",
    entityId: dto.id,
    metadata: {
      title: dto.title,
      itemType: dto.itemType,
      primaryPersonId: dto.primaryPersonId,
      primaryPersonName: dto.primaryPersonName,
    },
  });
  warmEntityEmbedding(userId, {
    entityType: "knowledge",
    entityId: dto.id,
    text: `${dto.title}\n${dto.content.slice(0, 600)}\ntags=${dto.tags.join(",")}${
      personName ? ` person=${personName}` : ""
    }`,
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
  if (!rows[0]) return null;
  let personName: string | null = null;
  if (rows[0].primaryPersonId) {
    const names = await personNamesById(userId, [rows[0].primaryPersonId]);
    personName = names.get(rows[0].primaryPersonId) ?? null;
  }
  return toDto(rows[0], personName);
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
    primaryPersonId?: string | null;
  },
): Promise<KnowledgeDto | null> {
  const existingRow = await getDb()
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.id, itemId), eq(knowledgeItems.userId, userId)))
    .limit(1);
  if (!existingRow[0]) return null;

  let tagsToWrite = input.tags;
  let primaryPersonIdToWrite = input.primaryPersonId;

  if (input.primaryPersonId !== undefined) {
    const base = [...(input.tags ?? existingRow[0].tags ?? [])].filter(
      (t) => !/^person:/i.test(t),
    );
    if (input.primaryPersonId) {
      const names = await personNamesById(userId, [input.primaryPersonId]);
      const name = names.get(input.primaryPersonId);
      tagsToWrite = name ? [...base, `person:${name}`] : base;
    } else {
      tagsToWrite = base;
    }
  } else if (input.tags !== undefined) {
    primaryPersonIdToWrite = await resolvePersonIdFromTags(userId, input.tags);
  }

  const [row] = await getDb()
    .update(knowledgeItems)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.itemType !== undefined ? { itemType: input.itemType } : {}),
      ...(tagsToWrite !== undefined ? { tags: tagsToWrite } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(primaryPersonIdToWrite !== undefined
        ? { primaryPersonId: primaryPersonIdToWrite }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(knowledgeItems.id, itemId), eq(knowledgeItems.userId, userId)))
    .returning();

  if (!row) return null;
  let personName: string | null = null;
  if (row.primaryPersonId) {
    const names = await personNamesById(userId, [row.primaryPersonId]);
    personName = names.get(row.primaryPersonId) ?? null;
  }
  const dto = toDto(row, personName);
  warmEntityEmbedding(userId, {
    entityType: "knowledge",
    entityId: dto.id,
    text: `${dto.title}\n${dto.content.slice(0, 600)}\ntags=${dto.tags.join(",")}${
      personName ? ` person=${personName}` : ""
    }`,
  });
  return dto;
}
