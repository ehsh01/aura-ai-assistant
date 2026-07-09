import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  knowledgeItems,
  notes,
  people,
  tasks,
  type Person,
} from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newPersonId } from "../lib/recall-format";
import { recordUserCorrection } from "./user-corrections";
import { writeAuditLog } from "./audit";
import { warmEntityEmbedding } from "./embedding-cache";

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
    text: `${dto.displayName} ${dto.organization ?? ""} ${dto.email ?? ""}`.trim(),
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
    text: `${dto.displayName} ${dto.organization ?? ""} ${dto.email ?? ""}`.trim(),
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

/** Resolve or create a person by display name (conservative dedup). */
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
  return createPersonForUser(userId, { displayName: trimmed });
}

export async function getPersonRelatedForUser(
  userId: string,
  personId: string,
): Promise<{
  person: PersonDto;
  openTasks: { id: string; title: string; time: string | null }[];
  taggedNotes: { id: string; title: string; preview: string }[];
  taggedKnowledge: { id: string; title: string; itemType: string }[];
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

  // Notes / knowledge linked via person:DisplayName tags (written on Inbox accept).
  const tagNeedle = `%person:${person.displayName}%`;
  const [taggedNotes, taggedKnowledge] = await Promise.all([
    getDb()
      .select({
        id: notes.id,
        title: notes.title,
        preview: notes.preview,
      })
      .from(notes)
      .where(
        and(eq(notes.userId, userId), sql`${notes.tags}::text ilike ${tagNeedle}`),
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
          sql`${knowledgeItems.tags}::text ilike ${tagNeedle}`,
        ),
      )
      .orderBy(desc(knowledgeItems.updatedAt))
      .limit(12),
  ]);

  return {
    person,
    openTasks: openTasks.map((t) => ({
      id: t.id,
      title: t.title,
      time: t.time ?? null,
    })),
    taggedNotes: taggedNotes.map((n) => ({
      id: n.id,
      title: n.title,
      preview: n.preview,
    })),
    taggedKnowledge: taggedKnowledge.map((k) => ({
      id: k.id,
      title: k.title,
      itemType: k.itemType,
    })),
  };
}
