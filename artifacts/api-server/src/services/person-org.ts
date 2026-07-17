import { and, eq } from "drizzle-orm";
import { organizations, people } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import {
  deleteEntityLink,
  listLinksFromEntity,
  listLinksToEntity,
  upsertEntityLink,
} from "./entity-links";

export const AFFILIATED_WITH = "affiliated_with";

export type OrgAffiliation = {
  organizationId: string;
  displayName: string;
  orgType: string;
};

export type PersonAffiliation = {
  personId: string;
  displayName: string;
  email: string | null;
  role: string | null;
};

export async function listPersonOrganizations(
  userId: string,
  personId: string,
): Promise<OrgAffiliation[]> {
  const links = await listLinksFromEntity(userId, "person", personId, {
    linkType: AFFILIATED_WITH,
    toEntityType: "organization",
  });
  if (links.length === 0) return [];
  const orgs: OrgAffiliation[] = [];
  for (const link of links) {
    const rows = await getDb()
      .select({
        id: organizations.id,
        displayName: organizations.displayName,
        orgType: organizations.orgType,
      })
      .from(organizations)
      .where(
        and(eq(organizations.id, link.toEntityId), eq(organizations.userId, userId)),
      )
      .limit(1);
    const org = rows[0];
    if (org) {
      orgs.push({
        organizationId: org.id,
        displayName: org.displayName,
        orgType: org.orgType,
      });
    }
  }
  return orgs;
}

export async function listOrganizationPeople(
  userId: string,
  organizationId: string,
): Promise<PersonAffiliation[]> {
  const links = await listLinksToEntity(userId, "organization", organizationId, {
    linkType: AFFILIATED_WITH,
    fromEntityType: "person",
  });
  if (links.length === 0) return [];
  const out: PersonAffiliation[] = [];
  for (const link of links) {
    const rows = await getDb()
      .select({
        id: people.id,
        displayName: people.displayName,
        email: people.email,
        role: people.role,
      })
      .from(people)
      .where(and(eq(people.id, link.fromEntityId), eq(people.userId, userId)))
      .limit(1);
    const p = rows[0];
    if (p) {
      out.push({
        personId: p.id,
        displayName: p.displayName,
        email: p.email ?? null,
        role: p.role ?? null,
      });
    }
  }
  return out;
}

export async function linkPersonToOrganization(
  userId: string,
  personId: string,
  organizationId: string,
  options?: { mirrorDisplayName?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const personRows = await getDb()
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.userId, userId)))
    .limit(1);
  if (!personRows[0]) return { ok: false, error: "Person not found" };

  const orgRows = await getDb()
    .select({ id: organizations.id, displayName: organizations.displayName })
    .from(organizations)
    .where(and(eq(organizations.id, organizationId), eq(organizations.userId, userId)))
    .limit(1);
  const org = orgRows[0];
  if (!org) return { ok: false, error: "Organization not found" };

  await upsertEntityLink(userId, {
    fromEntityType: "person",
    fromEntityId: personId,
    toEntityType: "organization",
    toEntityId: organizationId,
    linkType: AFFILIATED_WITH,
  });

  if (options?.mirrorDisplayName !== false) {
    await getDb()
      .update(people)
      .set({ organization: org.displayName, updatedAt: new Date() })
      .where(and(eq(people.id, personId), eq(people.userId, userId)));
  }

  return { ok: true };
}

export async function unlinkPersonFromOrganization(
  userId: string,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  return deleteEntityLink(userId, {
    fromEntityType: "person",
    fromEntityId: personId,
    toEntityType: "organization",
    toEntityId: organizationId,
    linkType: AFFILIATED_WITH,
  });
}
