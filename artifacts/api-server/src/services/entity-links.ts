import { and, eq, inArray } from "drizzle-orm";
import { entityLinks } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newEntityLinkId } from "../lib/recall-format";

export type EntityLinkDto = {
  id: string;
  fromEntityType: string;
  fromEntityId: string;
  toEntityType: string;
  toEntityId: string;
  linkType: string;
};

export type LinkedEntityRef = {
  entityType: string;
  entityId: string;
  linkType: string;
};

const PRIMARY_PERSON = "primary_person";

/** Upsert a typed link; idempotent on the unique (user, from, to, type) tuple. */
export async function upsertEntityLink(
  userId: string,
  input: {
    fromEntityType: string;
    fromEntityId: string;
    toEntityType: string;
    toEntityId: string;
    linkType: string;
    metadata?: Record<string, unknown>;
  },
): Promise<EntityLinkDto> {
  const now = new Date();
  const existing = await getDb()
    .select()
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.userId, userId),
        eq(entityLinks.fromEntityType, input.fromEntityType),
        eq(entityLinks.fromEntityId, input.fromEntityId),
        eq(entityLinks.toEntityType, input.toEntityType),
        eq(entityLinks.toEntityId, input.toEntityId),
        eq(entityLinks.linkType, input.linkType),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const [row] = await getDb()
      .update(entityLinks)
      .set({
        metadata: input.metadata ?? existing[0].metadata,
        updatedAt: now,
      })
      .where(eq(entityLinks.id, existing[0].id))
      .returning();
    return toDto(row!);
  }

  const [row] = await getDb()
    .insert(entityLinks)
    .values({
      id: newEntityLinkId(),
      userId,
      fromEntityType: input.fromEntityType,
      fromEntityId: input.fromEntityId,
      toEntityType: input.toEntityType,
      toEntityId: input.toEntityId,
      linkType: input.linkType,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toDto(row!);
}

/**
 * Keep the primary_person link in sync with note/task/knowledge/memory FKs.
 * Pass null to clear existing primary_person links from this entity.
 */
export async function syncPrimaryPersonLink(
  userId: string,
  fromEntityType: "note" | "knowledge" | "memory" | "task",
  fromEntityId: string,
  personId: string | null,
): Promise<void> {
  await getDb()
    .delete(entityLinks)
    .where(
      and(
        eq(entityLinks.userId, userId),
        eq(entityLinks.fromEntityType, fromEntityType),
        eq(entityLinks.fromEntityId, fromEntityId),
        eq(entityLinks.toEntityType, "person"),
        eq(entityLinks.linkType, PRIMARY_PERSON),
      ),
    );

  if (!personId) return;

  await upsertEntityLink(userId, {
    fromEntityType,
    fromEntityId,
    toEntityType: "person",
    toEntityId: personId,
    linkType: PRIMARY_PERSON,
  });
}

/** Entities that point at the given people (for Ask shared-context boost). */
export async function listEntitiesLinkedToPeople(
  userId: string,
  personIds: string[],
): Promise<LinkedEntityRef[]> {
  const unique = [...new Set(personIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const rows = await getDb()
    .select({
      fromEntityType: entityLinks.fromEntityType,
      fromEntityId: entityLinks.fromEntityId,
      linkType: entityLinks.linkType,
    })
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.userId, userId),
        eq(entityLinks.toEntityType, "person"),
        inArray(entityLinks.toEntityId, unique),
      ),
    );

  return rows.map((r) => ({
    entityType: r.fromEntityType,
    entityId: r.fromEntityId,
    linkType: r.linkType,
  }));
}

export function linkedEntityKeySet(links: LinkedEntityRef[]): Set<string> {
  return new Set(links.map((l) => `${l.entityType}:${l.entityId}`));
}

/** Links originating from a specific entity. */
export async function listLinksFromEntity(
  userId: string,
  fromEntityType: string,
  fromEntityId: string,
  options?: { linkType?: string; toEntityType?: string },
): Promise<EntityLinkDto[]> {
  const rows = await getDb()
    .select()
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.userId, userId),
        eq(entityLinks.fromEntityType, fromEntityType),
        eq(entityLinks.fromEntityId, fromEntityId),
        ...(options?.linkType ? [eq(entityLinks.linkType, options.linkType)] : []),
        ...(options?.toEntityType
          ? [eq(entityLinks.toEntityType, options.toEntityType)]
          : []),
      ),
    );
  return rows.map(toDto);
}

/** Links pointing at a specific entity. */
export async function listLinksToEntity(
  userId: string,
  toEntityType: string,
  toEntityId: string,
  options?: { linkType?: string; fromEntityType?: string },
): Promise<EntityLinkDto[]> {
  const rows = await getDb()
    .select()
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.userId, userId),
        eq(entityLinks.toEntityType, toEntityType),
        eq(entityLinks.toEntityId, toEntityId),
        ...(options?.linkType ? [eq(entityLinks.linkType, options.linkType)] : []),
        ...(options?.fromEntityType
          ? [eq(entityLinks.fromEntityType, options.fromEntityType)]
          : []),
      ),
    );
  return rows.map(toDto);
}

export async function deleteEntityLink(
  userId: string,
  input: {
    fromEntityType: string;
    fromEntityId: string;
    toEntityType: string;
    toEntityId: string;
    linkType: string;
  },
): Promise<boolean> {
  const deleted = await getDb()
    .delete(entityLinks)
    .where(
      and(
        eq(entityLinks.userId, userId),
        eq(entityLinks.fromEntityType, input.fromEntityType),
        eq(entityLinks.fromEntityId, input.fromEntityId),
        eq(entityLinks.toEntityType, input.toEntityType),
        eq(entityLinks.toEntityId, input.toEntityId),
        eq(entityLinks.linkType, input.linkType),
      ),
    )
    .returning({ id: entityLinks.id });
  return deleted.length > 0;
}

function toDto(row: typeof entityLinks.$inferSelect): EntityLinkDto {
  return {
    id: row.id,
    fromEntityType: row.fromEntityType,
    fromEntityId: row.fromEntityId,
    toEntityType: row.toEntityType,
    toEntityId: row.toEntityId,
    linkType: row.linkType,
  };
}
