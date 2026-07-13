import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import {
  WARRANTY_SUBJECT_TYPES,
  warranties,
  type Warranty,
  type WarrantySubjectType,
} from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newWarrantyId } from "../lib/recall-format";
import { writeAuditLog } from "./audit";
import { warmEntityEmbedding } from "./embedding-cache";
import { upsertEntityLink } from "./entity-links";
import { getVehicleForUser } from "./vehicles";

export type WarrantyDto = {
  id: string;
  title: string;
  subjectType: WarrantySubjectType;
  subjectId: string | null;
  subjectName: string | null;
  provider: string | null;
  expiresAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateWarrantyInput = {
  title: string;
  subjectType?: WarrantySubjectType | string;
  subjectId?: string | null;
  provider?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
};

export type UpdateWarrantyInput = Partial<CreateWarrantyInput>;

function normalizeSubjectType(raw?: string | null): WarrantySubjectType {
  if (raw && (WARRANTY_SUBJECT_TYPES as readonly string[]).includes(raw)) {
    return raw as WarrantySubjectType;
  }
  return "other";
}

/** Accept YYYY-MM-DD or null; reject nonsense. */
function normalizeExpiresAt(raw?: string | null): string | null {
  if (raw == null || raw.trim() === "") return null;
  const v = raw.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function toDto(row: Warranty, subjectName: string | null = null): WarrantyDto {
  return {
    id: row.id,
    title: row.title,
    subjectType: normalizeSubjectType(row.subjectType),
    subjectId: row.subjectId ?? null,
    subjectName,
    provider: row.provider ?? null,
    expiresAt: row.expiresAt ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function warrantySearchText(dto: WarrantyDto): string {
  return [
    dto.title,
    dto.subjectType,
    dto.subjectName,
    dto.provider,
    dto.expiresAt ? `expires ${dto.expiresAt}` : null,
    dto.notes,
  ]
    .filter(Boolean)
    .join(" ");
}

async function resolveSubjectName(
  userId: string,
  subjectType: WarrantySubjectType,
  subjectId: string | null,
): Promise<string | null> {
  if (subjectType !== "vehicle" || !subjectId) return null;
  const v = await getVehicleForUser(userId, subjectId);
  return v?.displayName ?? null;
}

async function syncVehicleCoverLink(
  userId: string,
  warrantyId: string,
  subjectType: WarrantySubjectType,
  subjectId: string | null,
): Promise<void> {
  if (subjectType !== "vehicle" || !subjectId) return;
  await upsertEntityLink(userId, {
    fromEntityType: "warranty",
    fromEntityId: warrantyId,
    toEntityType: "vehicle",
    toEntityId: subjectId,
    linkType: "covers",
  });
}

export async function createWarrantyForUser(
  userId: string,
  input: CreateWarrantyInput,
): Promise<WarrantyDto> {
  const subjectType = normalizeSubjectType(input.subjectType);
  let subjectId = input.subjectId ?? null;
  if (subjectType === "vehicle" && subjectId) {
    const v = await getVehicleForUser(userId, subjectId);
    if (!v) subjectId = null;
  } else if (subjectType !== "vehicle") {
    subjectId = null;
  }

  const now = new Date();
  const [row] = await getDb()
    .insert(warranties)
    .values({
      id: newWarrantyId(),
      userId,
      title: input.title.trim() || "Untitled warranty",
      subjectType,
      subjectId,
      provider: input.provider?.trim() || null,
      expiresAt: normalizeExpiresAt(input.expiresAt),
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const subjectName = await resolveSubjectName(userId, subjectType, subjectId);
  const dto = toDto(row!, subjectName);
  await syncVehicleCoverLink(userId, dto.id, subjectType, subjectId);
  await writeAuditLog({
    userId,
    action: "warranty_created",
    entityType: "warranty",
    entityId: dto.id,
    metadata: { title: dto.title, expiresAt: dto.expiresAt },
  });
  warmEntityEmbedding(userId, {
    entityType: "warranty",
    entityId: dto.id,
    text: warrantySearchText(dto),
  });
  return dto;
}

export async function listWarrantiesForUser(userId: string): Promise<WarrantyDto[]> {
  const rows = await getDb()
    .select()
    .from(warranties)
    .where(eq(warranties.userId, userId))
    .orderBy(asc(warranties.expiresAt), desc(warranties.updatedAt));

  const out: WarrantyDto[] = [];
  for (const row of rows) {
    const subjectType = normalizeSubjectType(row.subjectType);
    const subjectName = await resolveSubjectName(userId, subjectType, row.subjectId ?? null);
    out.push(toDto(row, subjectName));
  }
  return out;
}

export async function getWarrantyForUser(
  userId: string,
  warrantyId: string,
): Promise<WarrantyDto | null> {
  const rows = await getDb()
    .select()
    .from(warranties)
    .where(and(eq(warranties.id, warrantyId), eq(warranties.userId, userId)))
    .limit(1);
  if (!rows[0]) return null;
  const subjectType = normalizeSubjectType(rows[0].subjectType);
  const subjectName = await resolveSubjectName(
    userId,
    subjectType,
    rows[0].subjectId ?? null,
  );
  return toDto(rows[0], subjectName);
}

export async function updateWarrantyForUser(
  userId: string,
  warrantyId: string,
  input: UpdateWarrantyInput,
): Promise<WarrantyDto | null> {
  const existing = await getWarrantyForUser(userId, warrantyId);
  if (!existing) return null;

  const subjectType =
    input.subjectType !== undefined
      ? normalizeSubjectType(input.subjectType)
      : existing.subjectType;
  let subjectId =
    input.subjectId !== undefined ? input.subjectId : existing.subjectId;
  if (subjectType === "vehicle" && subjectId) {
    const v = await getVehicleForUser(userId, subjectId);
    if (!v) subjectId = null;
  } else if (subjectType !== "vehicle") {
    subjectId = null;
  }

  const [row] = await getDb()
    .update(warranties)
    .set({
      ...(input.title !== undefined
        ? { title: input.title.trim() || "Untitled warranty" }
        : {}),
      subjectType,
      subjectId,
      ...(input.provider !== undefined
        ? { provider: input.provider?.trim() || null }
        : {}),
      ...(input.expiresAt !== undefined
        ? { expiresAt: normalizeExpiresAt(input.expiresAt) }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(warranties.id, warrantyId), eq(warranties.userId, userId)))
    .returning();
  if (!row) return null;

  const subjectName = await resolveSubjectName(userId, subjectType, subjectId);
  const dto = toDto(row, subjectName);
  await syncVehicleCoverLink(userId, dto.id, subjectType, subjectId);
  warmEntityEmbedding(userId, {
    entityType: "warranty",
    entityId: dto.id,
    text: warrantySearchText(dto),
  });
  return dto;
}

export async function deleteWarrantyForUser(
  userId: string,
  warrantyId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .delete(warranties)
    .where(and(eq(warranties.id, warrantyId), eq(warranties.userId, userId)))
    .returning({ id: warranties.id });
  if (!row) return false;
  await writeAuditLog({
    userId,
    action: "warranty_deleted",
    entityType: "warranty",
    entityId: warrantyId,
  });
  return true;
}

/** Pure helper: warranties with dates within [today - pastGrace, today + upcomingDays]. */
export function findExpiringWarranties(
  items: { id: string; title: string; expiresAt: string | null; subjectName?: string | null }[],
  opts?: { upcomingDays?: number; pastGraceDays?: number; todayIso?: string },
): { id: string; title: string; expiresAt: string; daysUntil: number; subjectName: string | null }[] {
  const upcomingDays = opts?.upcomingDays ?? 90;
  const pastGraceDays = opts?.pastGraceDays ?? 14;
  const todayIso = opts?.todayIso ?? new Date().toISOString().slice(0, 10);
  const today = new Date(`${todayIso}T12:00:00Z`).getTime();

  const out: {
    id: string;
    title: string;
    expiresAt: string;
    daysUntil: number;
    subjectName: string | null;
  }[] = [];

  for (const w of items) {
    if (!w.expiresAt) continue;
    const exp = new Date(`${w.expiresAt}T12:00:00Z`).getTime();
    if (Number.isNaN(exp)) continue;
    const daysUntil = Math.round((exp - today) / 86_400_000);
    if (daysUntil < -pastGraceDays || daysUntil > upcomingDays) continue;
    out.push({
      id: w.id,
      title: w.title,
      expiresAt: w.expiresAt,
      daysUntil,
      subjectName: w.subjectName ?? null,
    });
  }

  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}

/** List warranties that have an expiry date (for insights / Ask). */
export async function listDatedWarrantiesForUser(userId: string): Promise<WarrantyDto[]> {
  const all = await listWarrantiesForUser(userId);
  return all.filter((w) => w.expiresAt);
}

/** DB-side upcoming window used by proactive insights. */
export async function listUpcomingWarrantiesForUser(
  userId: string,
  upcomingDays = 90,
): Promise<WarrantyDto[]> {
  const rows = await getDb()
    .select()
    .from(warranties)
    .where(
      and(
        eq(warranties.userId, userId),
        isNotNull(warranties.expiresAt),
        sql`${warranties.expiresAt} <= (CURRENT_DATE + ${upcomingDays}::int)`,
        sql`${warranties.expiresAt} >= (CURRENT_DATE - 14)`,
      ),
    )
    .orderBy(asc(warranties.expiresAt));

  const out: WarrantyDto[] = [];
  for (const row of rows) {
    const subjectType = normalizeSubjectType(row.subjectType);
    const subjectName = await resolveSubjectName(userId, subjectType, row.subjectId ?? null);
    out.push(toDto(row, subjectName));
  }
  return out;
}
