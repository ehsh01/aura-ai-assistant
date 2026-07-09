import { getDb } from "../lib/db";
import { userCorrections } from "@workspace/db/schema";
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
