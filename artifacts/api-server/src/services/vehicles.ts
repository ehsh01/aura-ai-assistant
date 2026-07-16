import { and, desc, eq } from "drizzle-orm";
import { vehicles, type Vehicle } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newVehicleId } from "../lib/recall-format";
import { writeAuditLog } from "./audit";
import { warmEntityEmbedding } from "./embedding-cache";

export type VehicleDto = {
  id: string;
  displayName: string;
  year: string | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  licensePlate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateVehicleInput = {
  displayName: string;
  year?: string | null;
  make?: string | null;
  model?: string | null;
  vin?: string | null;
  licensePlate?: string | null;
  notes?: string | null;
};

export type UpdateVehicleInput = Partial<CreateVehicleInput>;

function toDto(row: Vehicle): VehicleDto {
  return {
    id: row.id,
    displayName: row.displayName,
    year: row.year ?? null,
    make: row.make ?? null,
    model: row.model ?? null,
    vin: row.vin ?? null,
    licensePlate: row.licensePlate ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function vehicleSearchText(dto: VehicleDto): string {
  return [
    dto.displayName,
    dto.year,
    dto.make,
    dto.model,
    dto.vin,
    dto.licensePlate,
    dto.notes,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function createVehicleForUser(
  userId: string,
  input: CreateVehicleInput,
): Promise<VehicleDto> {
  const now = new Date();
  const [row] = await getDb()
    .insert(vehicles)
    .values({
      id: newVehicleId(),
      userId,
      displayName: input.displayName.trim() || "Untitled vehicle",
      year: input.year?.trim() || null,
      make: input.make?.trim() || null,
      model: input.model?.trim() || null,
      vin: input.vin?.trim().toUpperCase() || null,
      licensePlate: input.licensePlate?.trim().toUpperCase() || null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const dto = toDto(row!);
  await writeAuditLog({
    userId,
    action: "vehicle_created",
    entityType: "vehicle",
    entityId: dto.id,
    metadata: { displayName: dto.displayName },
  });
  warmEntityEmbedding(userId, {
    entityType: "vehicle",
    entityId: dto.id,
    text: vehicleSearchText(dto),
  });
  return dto;
}

export async function listVehiclesForUser(
  userId: string,
  options: { limit?: number } = {},
): Promise<VehicleDto[]> {
  const query = getDb()
    .select()
    .from(vehicles)
    .where(eq(vehicles.userId, userId))
    .orderBy(desc(vehicles.updatedAt));
  const rows = await (options.limit ? query.limit(options.limit) : query);
  return rows.map(toDto);
}

export async function getVehicleForUser(
  userId: string,
  vehicleId: string,
): Promise<VehicleDto | null> {
  const rows = await getDb()
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function updateVehicleForUser(
  userId: string,
  vehicleId: string,
  input: UpdateVehicleInput,
): Promise<VehicleDto | null> {
  const existing = await getVehicleForUser(userId, vehicleId);
  if (!existing) return null;

  const [row] = await getDb()
    .update(vehicles)
    .set({
      ...(input.displayName !== undefined
        ? { displayName: input.displayName.trim() || "Untitled vehicle" }
        : {}),
      ...(input.year !== undefined ? { year: input.year?.trim() || null } : {}),
      ...(input.make !== undefined ? { make: input.make?.trim() || null } : {}),
      ...(input.model !== undefined ? { model: input.model?.trim() || null } : {}),
      ...(input.vin !== undefined
        ? { vin: input.vin?.trim().toUpperCase() || null }
        : {}),
      ...(input.licensePlate !== undefined
        ? { licensePlate: input.licensePlate?.trim().toUpperCase() || null }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.userId, userId)))
    .returning();
  if (!row) return null;
  const dto = toDto(row);
  warmEntityEmbedding(userId, {
    entityType: "vehicle",
    entityId: dto.id,
    text: vehicleSearchText(dto),
  });
  return dto;
}

export async function deleteVehicleForUser(
  userId: string,
  vehicleId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .delete(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.userId, userId)))
    .returning({ id: vehicles.id });
  if (!row) return false;
  await writeAuditLog({
    userId,
    action: "vehicle_deleted",
    entityType: "vehicle",
    entityId: vehicleId,
  });
  return true;
}
