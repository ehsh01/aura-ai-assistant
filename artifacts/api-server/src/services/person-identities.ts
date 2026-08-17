import { and, eq } from "drizzle-orm";
import { personIdentities, type PersonIdentityKind } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newPersonIdentityId } from "../lib/recall-format";
import { normalizePhoneNumberE164 } from "./notification-settings";

function normalizeIdentityValue(kind: PersonIdentityKind, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (kind === "email") return trimmed.toLowerCase();
  if (kind === "phone") return normalizePhoneNumberE164(trimmed) ?? trimmed.replace(/\D/g, "");
  return trimmed.toLowerCase();
}

export async function upsertPersonIdentity(input: {
  userId: string;
  personId: string;
  kind: PersonIdentityKind;
  value: string;
  source?: string;
  confidence?: number;
}): Promise<void> {
  const value = normalizeIdentityValue(input.kind, input.value);
  if (!value) return;
  try {
    await getDb()
      .insert(personIdentities)
      .values({
        id: newPersonIdentityId(),
        userId: input.userId,
        personId: input.personId,
        kind: input.kind,
        value,
        confidence: input.confidence ?? 1,
        source: input.source ?? "manual",
      })
      .onConflictDoNothing();
  } catch {
    // Table may not exist yet on a rolling deploy.
  }
}

export async function syncPersonIdentitiesFromProfile(input: {
  userId: string;
  personId: string;
  email?: string | null;
  phone?: string | null;
  displayName?: string | null;
}): Promise<void> {
  if (input.email) {
    await upsertPersonIdentity({
      userId: input.userId,
      personId: input.personId,
      kind: "email",
      value: input.email,
      source: "profile",
    });
  }
  if (input.phone) {
    await upsertPersonIdentity({
      userId: input.userId,
      personId: input.personId,
      kind: "phone",
      value: input.phone,
      source: "profile",
    });
  }
  if (input.displayName) {
    await upsertPersonIdentity({
      userId: input.userId,
      personId: input.personId,
      kind: "nickname",
      value: input.displayName,
      source: "profile",
    });
  }
}

/** Extra aliases for entity resolution — value (lowercased) → personId. */
export async function listIdentityAliases(userId: string): Promise<Map<string, string>> {
  try {
    const rows = await getDb()
      .select({
        value: personIdentities.value,
        personId: personIdentities.personId,
      })
      .from(personIdentities)
      .where(eq(personIdentities.userId, userId));
    const map = new Map<string, string>();
    for (const row of rows) {
      const key = row.value.trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, row.personId);
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function findPersonIdByIdentity(
  userId: string,
  kind: PersonIdentityKind,
  value: string,
): Promise<string | null> {
  const normalized = normalizeIdentityValue(kind, value);
  if (!normalized) return null;
  try {
    const rows = await getDb()
      .select({ personId: personIdentities.personId })
      .from(personIdentities)
      .where(
        and(
          eq(personIdentities.userId, userId),
          eq(personIdentities.kind, kind),
          eq(personIdentities.value, normalized),
        ),
      )
      .limit(1);
    return rows[0]?.personId ?? null;
  } catch {
    return null;
  }
}
