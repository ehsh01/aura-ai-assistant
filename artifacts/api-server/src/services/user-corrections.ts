import { and, desc, eq } from "drizzle-orm";
import { userCorrections } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newCorrectionId } from "../lib/recall-format";

export type UserCorrectionDto = {
  id: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  createdAt: string;
};

export async function recordUserCorrection(
  userId: string,
  input: {
    entityType: string;
    entityId: string;
    fieldName: string;
    oldValue?: string | null;
    newValue?: string | null;
    reason?: string | null;
  },
): Promise<UserCorrectionDto> {
  const now = new Date();
  const [row] = await getDb()
    .insert(userCorrections)
    .values({
      id: newCorrectionId(),
      userId,
      entityType: input.entityType,
      entityId: input.entityId,
      fieldName: input.fieldName,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      reason: input.reason ?? null,
      createdAt: now,
    })
    .returning();
  return {
    id: row!.id,
    entityType: row!.entityType,
    entityId: row!.entityId,
    fieldName: row!.fieldName,
    oldValue: row!.oldValue ?? null,
    newValue: row!.newValue ?? null,
    reason: row!.reason ?? null,
    createdAt: row!.createdAt.toISOString(),
  };
}

/**
 * Map former person display names / emails to the current person id.
 * Latest correction for a given old value wins when names collide.
 */
export async function listPersonNameAliases(
  userId: string,
): Promise<Map<string, string>> {
  const rows = await getDb()
    .select({
      entityId: userCorrections.entityId,
      fieldName: userCorrections.fieldName,
      oldValue: userCorrections.oldValue,
      createdAt: userCorrections.createdAt,
    })
    .from(userCorrections)
    .where(and(eq(userCorrections.userId, userId), eq(userCorrections.entityType, "person")))
    .orderBy(desc(userCorrections.createdAt));

  const aliases = new Map<string, string>();
  for (const row of rows) {
    if (row.fieldName !== "displayName" && row.fieldName !== "email") continue;
    const oldValue = row.oldValue?.trim();
    if (!oldValue) continue;
    const key = oldValue.toLowerCase();
    if (!aliases.has(key)) aliases.set(key, row.entityId);
  }
  return aliases;
}

/** Resolve a free-text name/email against recorded person rename/email aliases. */
export function resolvePersonIdFromAliases(
  name: string,
  aliases: Map<string, string>,
): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return aliases.get(key) ?? null;
}

/**
 * Expand people with former names so Ask/waiting-on matching still finds them
 * after a rename correction.
 */
export function peopleWithAliasNames<T extends { id: string; displayName: string }>(
  people: T[],
  aliases: Map<string, string>,
): T[] {
  if (aliases.size === 0) return people;
  const byId = new Map(people.map((p) => [p.id, p] as const));
  const extra: T[] = [];
  const seen = new Set(people.map((p) => `${p.id}:${p.displayName.toLowerCase()}`));

  for (const [alias, personId] of aliases) {
    const person = byId.get(personId);
    if (!person) continue;
    if (alias === person.displayName.toLowerCase()) continue;
    const key = `${personId}:${alias}`;
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push({ ...person, displayName: alias });
  }
  return extra.length === 0 ? people : [...people, ...extra];
}
