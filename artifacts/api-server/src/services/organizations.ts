import { and, desc, eq } from "drizzle-orm";
import {
  ORGANIZATION_TYPES,
  organizations,
  type Organization,
  type OrganizationType,
} from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newOrganizationId } from "../lib/recall-format";
import { writeAuditLog } from "./audit";
import { warmEntityEmbedding } from "./embedding-cache";

export type OrganizationDto = {
  id: string;
  displayName: string;
  orgType: OrganizationType;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateOrganizationInput = {
  displayName: string;
  orgType?: OrganizationType | string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
};

export type UpdateOrganizationInput = Partial<CreateOrganizationInput>;

function normalizeOrgType(raw?: string | null): OrganizationType {
  if (raw && (ORGANIZATION_TYPES as readonly string[]).includes(raw)) {
    return raw as OrganizationType;
  }
  return "other";
}

function toDto(row: Organization): OrganizationDto {
  return {
    id: row.id,
    displayName: row.displayName,
    orgType: normalizeOrgType(row.orgType),
    email: row.email ?? null,
    phone: row.phone ?? null,
    website: row.website ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function orgSearchText(dto: OrganizationDto): string {
  return [
    dto.displayName,
    dto.orgType,
    dto.email,
    dto.phone,
    dto.website,
    dto.notes,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function createOrganizationForUser(
  userId: string,
  input: CreateOrganizationInput,
): Promise<OrganizationDto> {
  const now = new Date();
  const [row] = await getDb()
    .insert(organizations)
    .values({
      id: newOrganizationId(),
      userId,
      displayName: input.displayName.trim() || "Untitled organization",
      orgType: normalizeOrgType(input.orgType),
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      website: input.website?.trim() || null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const dto = toDto(row!);
  await writeAuditLog({
    userId,
    action: "organization_created",
    entityType: "organization",
    entityId: dto.id,
    metadata: { displayName: dto.displayName },
  });
  warmEntityEmbedding(userId, {
    entityType: "organization",
    entityId: dto.id,
    text: orgSearchText(dto),
  });
  return dto;
}

export async function listOrganizationsForUser(
  userId: string,
  options: { limit?: number } = {},
): Promise<OrganizationDto[]> {
  const query = getDb()
    .select()
    .from(organizations)
    .where(eq(organizations.userId, userId))
    .orderBy(desc(organizations.updatedAt));
  const rows = await (options.limit ? query.limit(options.limit) : query);
  return rows.map(toDto);
}

export async function getOrganizationForUser(
  userId: string,
  organizationId: string,
): Promise<OrganizationDto | null> {
  const rows = await getDb()
    .select()
    .from(organizations)
    .where(
      and(eq(organizations.id, organizationId), eq(organizations.userId, userId)),
    )
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function updateOrganizationForUser(
  userId: string,
  organizationId: string,
  input: UpdateOrganizationInput,
): Promise<OrganizationDto | null> {
  const existing = await getOrganizationForUser(userId, organizationId);
  if (!existing) return null;

  const [row] = await getDb()
    .update(organizations)
    .set({
      ...(input.displayName !== undefined
        ? { displayName: input.displayName.trim() || "Untitled organization" }
        : {}),
      ...(input.orgType !== undefined
        ? { orgType: normalizeOrgType(input.orgType) }
        : {}),
      ...(input.email !== undefined ? { email: input.email?.trim() || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
      ...(input.website !== undefined
        ? { website: input.website?.trim() || null }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(eq(organizations.id, organizationId), eq(organizations.userId, userId)),
    )
    .returning();
  if (!row) return null;
  const dto = toDto(row);
  warmEntityEmbedding(userId, {
    entityType: "organization",
    entityId: dto.id,
    text: orgSearchText(dto),
  });
  return dto;
}

export async function deleteOrganizationForUser(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .delete(organizations)
    .where(
      and(eq(organizations.id, organizationId), eq(organizations.userId, userId)),
    )
    .returning({ id: organizations.id });
  if (!row) return false;
  await writeAuditLog({
    userId,
    action: "organization_deleted",
    entityType: "organization",
    entityId: organizationId,
  });
  return true;
}
