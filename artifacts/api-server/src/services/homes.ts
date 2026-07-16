import { and, desc, eq } from "drizzle-orm";
import { homes, type Home } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newHomeId } from "../lib/recall-format";
import { writeAuditLog } from "./audit";
import { warmEntityEmbedding } from "./embedding-cache";

export type HomeDto = {
  id: string;
  displayName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateHomeInput = {
  displayName: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  notes?: string | null;
};

export type UpdateHomeInput = Partial<CreateHomeInput>;

function toDto(row: Home): HomeDto {
  return {
    id: row.id,
    displayName: row.displayName,
    addressLine1: row.addressLine1 ?? null,
    addressLine2: row.addressLine2 ?? null,
    city: row.city ?? null,
    region: row.region ?? null,
    postalCode: row.postalCode ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function homeSearchText(dto: HomeDto): string {
  return [
    dto.displayName,
    dto.addressLine1,
    dto.addressLine2,
    dto.city,
    dto.region,
    dto.postalCode,
    dto.notes,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function createHomeForUser(
  userId: string,
  input: CreateHomeInput,
): Promise<HomeDto> {
  const now = new Date();
  const [row] = await getDb()
    .insert(homes)
    .values({
      id: newHomeId(),
      userId,
      displayName: input.displayName.trim() || "Untitled home",
      addressLine1: input.addressLine1?.trim() || null,
      addressLine2: input.addressLine2?.trim() || null,
      city: input.city?.trim() || null,
      region: input.region?.trim() || null,
      postalCode: input.postalCode?.trim() || null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const dto = toDto(row!);
  await writeAuditLog({
    userId,
    action: "home_created",
    entityType: "home",
    entityId: dto.id,
    metadata: { displayName: dto.displayName },
  });
  warmEntityEmbedding(userId, {
    entityType: "home",
    entityId: dto.id,
    text: homeSearchText(dto),
  });
  return dto;
}

export async function listHomesForUser(
  userId: string,
  options: { limit?: number } = {},
): Promise<HomeDto[]> {
  const query = getDb()
    .select()
    .from(homes)
    .where(eq(homes.userId, userId))
    .orderBy(desc(homes.updatedAt));
  const rows = await (options.limit ? query.limit(options.limit) : query);
  return rows.map(toDto);
}

export async function getHomeForUser(
  userId: string,
  homeId: string,
): Promise<HomeDto | null> {
  const rows = await getDb()
    .select()
    .from(homes)
    .where(and(eq(homes.id, homeId), eq(homes.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function updateHomeForUser(
  userId: string,
  homeId: string,
  input: UpdateHomeInput,
): Promise<HomeDto | null> {
  const existing = await getHomeForUser(userId, homeId);
  if (!existing) return null;

  const [row] = await getDb()
    .update(homes)
    .set({
      ...(input.displayName !== undefined
        ? { displayName: input.displayName.trim() || "Untitled home" }
        : {}),
      ...(input.addressLine1 !== undefined
        ? { addressLine1: input.addressLine1?.trim() || null }
        : {}),
      ...(input.addressLine2 !== undefined
        ? { addressLine2: input.addressLine2?.trim() || null }
        : {}),
      ...(input.city !== undefined ? { city: input.city?.trim() || null } : {}),
      ...(input.region !== undefined ? { region: input.region?.trim() || null } : {}),
      ...(input.postalCode !== undefined
        ? { postalCode: input.postalCode?.trim() || null }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(homes.id, homeId), eq(homes.userId, userId)))
    .returning();
  if (!row) return null;
  const dto = toDto(row);
  warmEntityEmbedding(userId, {
    entityType: "home",
    entityId: dto.id,
    text: homeSearchText(dto),
  });
  return dto;
}

export async function deleteHomeForUser(
  userId: string,
  homeId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .delete(homes)
    .where(and(eq(homes.id, homeId), eq(homes.userId, userId)))
    .returning({ id: homes.id });
  if (!row) return false;
  await writeAuditLog({
    userId,
    action: "home_deleted",
    entityType: "home",
    entityId: homeId,
  });
  return true;
}
