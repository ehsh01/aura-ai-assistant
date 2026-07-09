import { auditLog } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newAuditId } from "../lib/recall-format";

export async function writeAuditLog(input: {
  userId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await getDb().insert(auditLog).values({
      id: newAuditId(),
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    });
  } catch {
    // Audit must never break primary flows.
  }
}
