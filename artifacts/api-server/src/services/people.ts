import { and, desc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  entityLinks,
  knowledgeItems,
  lifeMemories,
  notes,
  people,
  tasks,
  type Person,
} from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newPersonId } from "../lib/recall-format";
import { recordUserCorrection, listPersonNameAliases } from "./user-corrections";
import { writeAuditLog } from "./audit";
import { warmEntityEmbedding } from "./embedding-cache";
import { personEmbeddingText } from "./embedding-text";
import { listEntitiesLinkedToPeople } from "./entity-links";

export type PersonDto = {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  organization: string | null;
  department: string | null;
  role: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatePersonInput = {
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
  department?: string | null;
  role?: string | null;
  notes?: string | null;
};

export type UpdatePersonInput = Partial<CreatePersonInput>;

function toDto(row: Person): PersonDto {
  return {
    id: row.id,
    displayName: row.displayName,
    firstName: row.firstName ?? null,
    lastName: row.lastName ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    organization: row.organization ?? null,
    department: row.department ?? null,
    role: row.role ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createPersonForUser(
  userId: string,
  input: CreatePersonInput,
): Promise<PersonDto> {
  const now = new Date();
  const [row] = await getDb()
    .insert(people)
    .values({
      id: newPersonId(),
      userId,
      displayName: input.displayName.trim(),
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      organization: input.organization ?? null,
      department: input.department ?? null,
      role: input.role ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const dto = toDto(row!);
  await writeAuditLog({
    userId,
    action: "person_created",
    entityType: "person",
    entityId: dto.id,
    metadata: { displayName: dto.displayName },
  });
  warmEntityEmbedding(userId, {
    entityType: "person",
    entityId: dto.id,
    text: personEmbeddingText(dto),
  });
  return dto;
}

export async function listPeopleForUser(userId: string): Promise<PersonDto[]> {
  const rows = await getDb()
    .select()
    .from(people)
    .where(eq(people.userId, userId))
    .orderBy(desc(people.updatedAt));
  return rows.map(toDto);
}

export async function getPersonForUser(
  userId: string,
  personId: string,
): Promise<PersonDto | null> {
  const rows = await getDb()
    .select()
    .from(people)
    .where(and(eq(people.id, personId), eq(people.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function updatePersonForUser(
  userId: string,
  personId: string,
  input: UpdatePersonInput,
): Promise<PersonDto | null> {
  const existing = await getPersonForUser(userId, personId);
  if (!existing) return null;

  const fields: (keyof UpdatePersonInput)[] = [
    "displayName",
    "firstName",
    "lastName",
    "email",
    "phone",
    "organization",
    "department",
    "role",
    "notes",
  ];

  for (const field of fields) {
    if (input[field] !== undefined) {
      const oldVal = existing[field as keyof PersonDto];
      const newVal = input[field];
      if (String(oldVal ?? "") !== String(newVal ?? "")) {
        await recordUserCorrection(userId, {
          entityType: "person",
          entityId: personId,
          fieldName: field,
          oldValue: oldVal != null ? String(oldVal) : null,
          newValue: newVal != null ? String(newVal) : null,
        });
      }
    }
  }

  const [row] = await getDb()
    .update(people)
    .set({
      ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.organization !== undefined ? { organization: input.organization } : {}),
      ...(input.department !== undefined ? { department: input.department } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(people.id, personId), eq(people.userId, userId)))
    .returning();
  if (!row) return null;
  const dto = toDto(row);

  // Keep person: tags in sync when the display name changes.
  const oldName = existing.displayName.trim();
  const newName = dto.displayName.trim();
  if (
    input.displayName !== undefined &&
    oldName &&
    newName &&
    oldName.toLowerCase() !== newName.toLowerCase()
  ) {
    void rewritePersonTagsForUser(userId, oldName, newName).catch(() => {
      // Best-effort; People page still works if tag rewrite fails.
    });
  }

  warmEntityEmbedding(userId, {
    entityType: "person",
    entityId: dto.id,
    text: personEmbeddingText(dto),
  });
  return dto;
}

function replacePersonTag(
  tags: unknown,
  oldTag: string,
  newTag: string,
): string[] | null {
  if (!Array.isArray(tags)) return null;
  let changed = false;
  const next = tags.map((t) => {
    if (typeof t !== "string") return String(t);
    if (t.toLowerCase() === oldTag.toLowerCase()) {
      changed = true;
      return newTag;
    }
    return t;
  });
  return changed ? next : null;
}

/** Rewrite person:OldName tags to person:NewName on notes, knowledge, and tasks. */
async function rewritePersonTagsForUser(
  userId: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const oldTag = `person:${oldName}`;
  const newTag = `person:${newName}`;
  const needle = `%person:${oldName}%`;
  const db = getDb();

  const noteRows = await db
    .select({ id: notes.id, tags: notes.tags })
    .from(notes)
    .where(and(eq(notes.userId, userId), sql`${notes.tags}::text ilike ${needle}`));
  for (const n of noteRows) {
    const next = replacePersonTag(n.tags, oldTag, newTag);
    if (!next) continue;
    await db
      .update(notes)
      .set({ tags: next, updatedAt: new Date() })
      .where(and(eq(notes.id, n.id), eq(notes.userId, userId)));
  }

  const knowledgeRows = await db
    .select({ id: knowledgeItems.id, tags: knowledgeItems.tags })
    .from(knowledgeItems)
    .where(
      and(
        eq(knowledgeItems.userId, userId),
        sql`${knowledgeItems.tags}::text ilike ${needle}`,
      ),
    );
  for (const k of knowledgeRows) {
    const next = replacePersonTag(k.tags, oldTag, newTag);
    if (!next) continue;
    await db
      .update(knowledgeItems)
      .set({ tags: next, updatedAt: new Date() })
      .where(and(eq(knowledgeItems.id, k.id), eq(knowledgeItems.userId, userId)));
  }

  const taskRows = await db
    .select({ id: tasks.id, tags: tasks.tags })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), sql`${tasks.tags}::text ilike ${needle}`));
  for (const t of taskRows) {
    const next = replacePersonTag(t.tags, oldTag, newTag);
    if (!next) continue;
    await db
      .update(tasks)
      .set({ tags: next, updatedAt: new Date() })
      .where(and(eq(tasks.id, t.id), eq(tasks.userId, userId)));
  }
}

/** Resolve or create a person by display name (conservative dedup + rename aliases). */
export async function resolvePersonByName(
  userId: string,
  displayName: string,
): Promise<PersonDto> {
  const trimmed = displayName.trim();
  const rows = await getDb()
    .select()
    .from(people)
    .where(
      and(
        eq(people.userId, userId),
        or(
          ilike(people.displayName, trimmed),
          ilike(people.email, trimmed),
        ),
      ),
    )
    .limit(1);
  if (rows[0]) return toDto(rows[0]);

  const aliases = await listPersonNameAliases(userId);
  const aliasId = aliases.get(trimmed.toLowerCase());
  if (aliasId) {
    const aliased = await getPersonForUser(userId, aliasId);
    if (aliased) return aliased;
  }

  return createPersonForUser(userId, { displayName: trimmed });
}

/**
 * Merge duplicate person into keeper: repoint FKs/links/tags, fold blank profile
 * fields, record alias, delete the duplicate.
 */
export async function mergePeopleForUser(
  userId: string,
  keepId: string,
  mergeId: string,
): Promise<{ kept: PersonDto; mergedId: string } | null> {
  if (keepId === mergeId) {
    throw new Error("Cannot merge a person into themselves");
  }
  const kept = await getPersonForUser(userId, keepId);
  const duplicate = await getPersonForUser(userId, mergeId);
  if (!kept || !duplicate) return null;

  const db = getDb();
  const now = new Date();

  await db
    .update(notes)
    .set({ primaryPersonId: keepId, updatedAt: now })
    .where(and(eq(notes.userId, userId), eq(notes.primaryPersonId, mergeId)));
  await db
    .update(knowledgeItems)
    .set({ primaryPersonId: keepId, updatedAt: now })
    .where(
      and(eq(knowledgeItems.userId, userId), eq(knowledgeItems.primaryPersonId, mergeId)),
    );
  await db
    .update(lifeMemories)
    .set({ primaryPersonId: keepId, updatedAt: now })
    .where(and(eq(lifeMemories.userId, userId), eq(lifeMemories.primaryPersonId, mergeId)));
  await db
    .update(tasks)
    .set({ requesterPersonId: keepId, updatedAt: now })
    .where(and(eq(tasks.userId, userId), eq(tasks.requesterPersonId, mergeId)));

  const links = await db
    .select()
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.userId, userId),
        or(
          and(eq(entityLinks.fromEntityType, "person"), eq(entityLinks.fromEntityId, mergeId)),
          and(eq(entityLinks.toEntityType, "person"), eq(entityLinks.toEntityId, mergeId)),
        )!,
      ),
    );

  for (const link of links) {
    const nextFrom =
      link.fromEntityType === "person" && link.fromEntityId === mergeId
        ? keepId
        : link.fromEntityId;
    const nextTo =
      link.toEntityType === "person" && link.toEntityId === mergeId ? keepId : link.toEntityId;
    try {
      await db
        .update(entityLinks)
        .set({
          fromEntityId: nextFrom,
          toEntityId: nextTo,
          updatedAt: now,
        })
        .where(eq(entityLinks.id, link.id));
    } catch {
      await db.delete(entityLinks).where(eq(entityLinks.id, link.id));
    }
  }

  const folded: UpdatePersonInput = {};
  if (!kept.email && duplicate.email) folded.email = duplicate.email;
  if (!kept.phone && duplicate.phone) folded.phone = duplicate.phone;
  if (!kept.organization && duplicate.organization) folded.organization = duplicate.organization;
  if (!kept.department && duplicate.department) folded.department = duplicate.department;
  if (!kept.role && duplicate.role) folded.role = duplicate.role;
  if (!kept.firstName && duplicate.firstName) folded.firstName = duplicate.firstName;
  if (!kept.lastName && duplicate.lastName) folded.lastName = duplicate.lastName;
  if ((!kept.notes || !kept.notes.trim()) && duplicate.notes?.trim()) {
    folded.notes = duplicate.notes;
  } else if (kept.notes && duplicate.notes?.trim() && !kept.notes.includes(duplicate.notes.trim())) {
    folded.notes = `${kept.notes.trim()}\n\n[Merged from ${duplicate.displayName}]\n${duplicate.notes.trim()}`;
  }

  await recordUserCorrection(userId, {
    entityType: "person",
    entityId: keepId,
    fieldName: "displayName",
    oldValue: duplicate.displayName,
    newValue: kept.displayName,
  });

  if (Object.keys(folded).length > 0) {
    await updatePersonForUser(userId, keepId, folded);
  }

  if (duplicate.displayName.trim().toLowerCase() !== kept.displayName.trim().toLowerCase()) {
    await rewritePersonTagsForUser(userId, duplicate.displayName, kept.displayName);
  }

  await db.delete(people).where(and(eq(people.id, mergeId), eq(people.userId, userId)));

  await writeAuditLog({
    userId,
    action: "person_merged",
    entityType: "person",
    entityId: keepId,
    metadata: {
      mergedId: mergeId,
      mergedName: duplicate.displayName,
      keptName: kept.displayName,
    },
  });

  const refreshed = await getPersonForUser(userId, keepId);
  return refreshed ? { kept: refreshed, mergedId: mergeId } : null;
}

export async function getPersonRelatedForUser(
  userId: string,
  personId: string,
): Promise<{
  person: PersonDto;
  openTasks: { id: string; title: string; time: string | null }[];
  taggedNotes: { id: string; title: string; preview: string }[];
  taggedKnowledge: { id: string; title: string; itemType: string }[];
  linkedMemories: { id: string; title: string; domain: string }[];
} | null> {
  const person = await getPersonForUser(userId, personId);
  if (!person) return null;
  const openTasks = await getDb()
    .select({ id: tasks.id, title: tasks.title, time: tasks.time })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.requesterPersonId, personId),
        eq(tasks.completed, false),
      ),
    );

  // Prefer FK; fall back to person: tags for rows not yet backfilled.
  const tagNeedle = `%person:${person.displayName}%`;
  const [taggedNotes, taggedKnowledge, linkedMemories, entityLinks] = await Promise.all([
    getDb()
      .select({
        id: notes.id,
        title: notes.title,
        preview: notes.preview,
      })
      .from(notes)
      .where(
        and(
          eq(notes.userId, userId),
          or(
            eq(notes.primaryPersonId, personId),
            sql`${notes.tags}::text ilike ${tagNeedle}`,
          ),
        ),
      )
      .orderBy(desc(notes.updatedAt))
      .limit(12),
    getDb()
      .select({
        id: knowledgeItems.id,
        title: knowledgeItems.title,
        itemType: knowledgeItems.itemType,
      })
      .from(knowledgeItems)
      .where(
        and(
          eq(knowledgeItems.userId, userId),
          or(
            eq(knowledgeItems.primaryPersonId, personId),
            sql`${knowledgeItems.tags}::text ilike ${tagNeedle}`,
          ),
        ),
      )
      .orderBy(desc(knowledgeItems.updatedAt))
      .limit(12),
    getDb()
      .select({
        id: lifeMemories.id,
        title: lifeMemories.title,
        domain: lifeMemories.domain,
      })
      .from(lifeMemories)
      .where(
        and(
          eq(lifeMemories.userId, userId),
          eq(lifeMemories.primaryPersonId, personId),
          eq(lifeMemories.status, "active"),
          or(isNull(lifeMemories.expiresAt), gt(lifeMemories.expiresAt, new Date()))!,
        ),
      )
      .orderBy(desc(lifeMemories.updatedAt))
      .limit(12),
    listEntitiesLinkedToPeople(userId, [personId]),
  ]);

  // Prefer FK/tag results; fill gaps from entity_links when backfill is ahead of tags.
  const noteIds = new Set(taggedNotes.map((n) => n.id));
  const knowledgeIds = new Set(taggedKnowledge.map((k) => k.id));
  const memoryIds = new Set(linkedMemories.map((m) => m.id));
  const linkNoteIds = entityLinks
    .filter((l) => l.entityType === "note" && !noteIds.has(l.entityId))
    .map((l) => l.entityId)
    .slice(0, 12);
  const linkKnowledgeIds = entityLinks
    .filter((l) => l.entityType === "knowledge" && !knowledgeIds.has(l.entityId))
    .map((l) => l.entityId)
    .slice(0, 12);
  const linkMemoryIds = entityLinks
    .filter((l) => l.entityType === "memory" && !memoryIds.has(l.entityId))
    .map((l) => l.entityId)
    .slice(0, 12);

  const [extraNotes, extraKnowledge, extraMemories] = await Promise.all([
    linkNoteIds.length === 0
      ? Promise.resolve([])
      : getDb()
          .select({ id: notes.id, title: notes.title, preview: notes.preview })
          .from(notes)
          .where(and(eq(notes.userId, userId), inArray(notes.id, linkNoteIds))),
    linkKnowledgeIds.length === 0
      ? Promise.resolve([])
      : getDb()
          .select({
            id: knowledgeItems.id,
            title: knowledgeItems.title,
            itemType: knowledgeItems.itemType,
          })
          .from(knowledgeItems)
          .where(
            and(
              eq(knowledgeItems.userId, userId),
              inArray(knowledgeItems.id, linkKnowledgeIds),
            ),
          ),
    linkMemoryIds.length === 0
      ? Promise.resolve([])
      : getDb()
          .select({
            id: lifeMemories.id,
            title: lifeMemories.title,
            domain: lifeMemories.domain,
          })
          .from(lifeMemories)
          .where(
            and(
              eq(lifeMemories.userId, userId),
              inArray(lifeMemories.id, linkMemoryIds),
              eq(lifeMemories.status, "active"),
              or(isNull(lifeMemories.expiresAt), gt(lifeMemories.expiresAt, new Date()))!,
            ),
          ),
  ]);

  return {
    person,
    openTasks: openTasks.map((t) => ({
      id: t.id,
      title: t.title,
      time: t.time ?? null,
    })),
    taggedNotes: [...taggedNotes, ...extraNotes].slice(0, 12).map((n) => ({
      id: n.id,
      title: n.title,
      preview: n.preview,
    })),
    taggedKnowledge: [...taggedKnowledge, ...extraKnowledge].slice(0, 12).map((k) => ({
      id: k.id,
      title: k.title,
      itemType: k.itemType,
    })),
    linkedMemories: [...linkedMemories, ...extraMemories].slice(0, 12).map((m) => ({
      id: m.id,
      title: m.title,
      domain: m.domain,
    })),
  };
}

export type PersonTimelineItem = {
  entityType: "task" | "note" | "knowledge" | "memory";
  entityId: string;
  title: string;
  subtitle?: string;
  at: string;
  href: string;
};

/** Chronological feed across notes/tasks/knowledge/memories for a person. */
export async function getPersonTimelineForUser(
  userId: string,
  personId: string,
  limit = 40,
): Promise<{ person: PersonDto; items: PersonTimelineItem[] } | null> {
  const person = await getPersonForUser(userId, personId);
  if (!person) return null;

  const tagNeedle = `%person:${person.displayName}%`;
  const [taskRows, noteRows, knowledgeRows, memoryRows] = await Promise.all([
    getDb()
      .select({
        id: tasks.id,
        title: tasks.title,
        updatedAt: tasks.updatedAt,
        completed: tasks.completed,
      })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.requesterPersonId, personId)))
      .orderBy(desc(tasks.updatedAt))
      .limit(limit),
    getDb()
      .select({
        id: notes.id,
        title: notes.title,
        preview: notes.preview,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .where(
        and(
          eq(notes.userId, userId),
          or(eq(notes.primaryPersonId, personId), sql`${notes.tags}::text ilike ${tagNeedle}`),
        ),
      )
      .orderBy(desc(notes.updatedAt))
      .limit(limit),
    getDb()
      .select({
        id: knowledgeItems.id,
        title: knowledgeItems.title,
        itemType: knowledgeItems.itemType,
        updatedAt: knowledgeItems.updatedAt,
      })
      .from(knowledgeItems)
      .where(
        and(
          eq(knowledgeItems.userId, userId),
          or(
            eq(knowledgeItems.primaryPersonId, personId),
            sql`${knowledgeItems.tags}::text ilike ${tagNeedle}`,
          ),
        ),
      )
      .orderBy(desc(knowledgeItems.updatedAt))
      .limit(limit),
    getDb()
      .select({
        id: lifeMemories.id,
        title: lifeMemories.title,
        domain: lifeMemories.domain,
        updatedAt: lifeMemories.updatedAt,
      })
      .from(lifeMemories)
      .where(
        and(
          eq(lifeMemories.userId, userId),
          eq(lifeMemories.primaryPersonId, personId),
          eq(lifeMemories.status, "active"),
        ),
      )
      .orderBy(desc(lifeMemories.updatedAt))
      .limit(limit),
  ]);

  const items: PersonTimelineItem[] = [
    ...taskRows.map((t) => ({
      entityType: "task" as const,
      entityId: t.id,
      title: t.title,
      subtitle: t.completed ? "Completed task" : "Open task",
      at: t.updatedAt.toISOString(),
      href: `/tasks?task=${encodeURIComponent(t.id)}`,
    })),
    ...noteRows.map((n) => ({
      entityType: "note" as const,
      entityId: n.id,
      title: n.title,
      subtitle: n.preview?.slice(0, 120) || undefined,
      at: n.updatedAt.toISOString(),
      href: `/notes?note=${encodeURIComponent(n.id)}`,
    })),
    ...knowledgeRows.map((k) => ({
      entityType: "knowledge" as const,
      entityId: k.id,
      title: k.title,
      subtitle: k.itemType,
      at: k.updatedAt.toISOString(),
      href: `/knowledge?id=${encodeURIComponent(k.id)}`,
    })),
    ...memoryRows.map((m) => ({
      entityType: "memory" as const,
      entityId: m.id,
      title: m.title,
      subtitle: m.domain,
      at: m.updatedAt.toISOString(),
      href: `/memory?memory=${encodeURIComponent(m.id)}`,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);

  return { person, items };
}
