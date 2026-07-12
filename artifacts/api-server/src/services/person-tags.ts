import { and, eq, inArray } from "drizzle-orm";
import { people } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { listPersonNameAliases } from "./user-corrections";

/** Strip existing person: tags and optionally append person:DisplayName. */
export function syncPersonTag(
  tags: string[] | undefined | null,
  personName: string | null | undefined,
): string[] {
  const base = [...(tags ?? [])].filter((t) => !/^person:/i.test(t));
  const name = personName?.trim();
  if (!name) return base;
  return [...base, `person:${name}`];
}

export function firstPersonTagName(tags: string[] | undefined | null): string | null {
  for (const t of tags ?? []) {
    const m = /^person:(.+)$/i.exec(t);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

export async function personNamesById(
  userId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: people.id, displayName: people.displayName })
    .from(people)
    .where(and(eq(people.userId, userId), inArray(people.id, unique)));
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

/** Resolve a person id from tags when FK is missing (best-effort). */
export async function resolvePersonIdFromTags(
  userId: string,
  tags: string[] | undefined | null,
): Promise<string | null> {
  const name = firstPersonTagName(tags);
  if (!name) return null;
  const [rows, aliases] = await Promise.all([
    getDb()
      .select({ id: people.id, displayName: people.displayName })
      .from(people)
      .where(eq(people.userId, userId)),
    listPersonNameAliases(userId),
  ]);
  const lower = name.toLowerCase();
  const aliasId = aliases.get(lower);
  if (aliasId) return aliasId;
  const hit = rows.find(
    (p) =>
      p.displayName.toLowerCase() === lower ||
      p.displayName.toLowerCase().includes(lower) ||
      lower.includes(p.displayName.toLowerCase()),
  );
  return hit?.id ?? null;
}
