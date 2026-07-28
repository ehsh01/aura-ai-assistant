import { and, desc, eq } from "drizzle-orm";
import { auditLog, type AuditLogEntry } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newAuditId } from "../lib/recall-format";

export type AuditEntryDto = {
  id: string;
  action: string;
  label: string;
  entityType: string | null;
  entityId: string | null;
  href: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

const ACTION_LABELS: Record<string, string> = {
  capture_created: "Capture created",
  capture_extracted: "AI extracted a capture",
  capture_accepted: "Inbox item accepted",
  capture_auto_accepted: "Capture auto-organized",
  capture_snoozed: "Inbox item snoozed",
  capture_dismissed: "Inbox item dismissed",
  task_created: "Task created",
  task_completed: "Task completed",
  task_reopened: "Task reopened",
  note_created: "Note created",
  connector_sync: "Connector synced",
  query_answered: "Ask Recall answered a question",
  knowledge_created: "Knowledge item added",
  document_created: "Document added",
  person_created: "Person added",
  follow_up_created: "Follow-up task created",
  waiting_dismissed: "Waiting item dismissed",
  waiting_item_created: "Waiting item tracked",
  waiting_candidate_created: "Follow-up suggestion queued for review",
  waiting_candidate_confirmed: "Follow-up suggestion confirmed",
  waiting_item_updated: "Waiting item corrected",
  waiting_item_snoozed: "Waiting item snoozed",
  waiting_item_dismissed: "Waiting item dismissed",
  waiting_item_reopened: "Waiting item reopened",
  waiting_item_completed: "Waiting item completed",
  waiting_reply_completed: "Reply resolved the commitment",
  waiting_reply_revised: "Reply revised the commitment",
  waiting_reply_still_waiting: "Reply: still waiting",
  waiting_reply_unclear: "Reply needs review",
  waiting_follow_up_drafted: "Follow-up drafted",
  waiting_follow_up_sent: "Follow-up marked sent",
  attention_created: "Deadline tracked",
  attention_updated: "Deadline corrected",
  attention_confirmed: "Deadline confirmed",
  attention_snoozed: "Deadline snoozed",
  attention_dismissed: "Deadline dismissed",
  attention_completed: "Deadline completed",
  attention_reopened: "Deadline reopened",
};

function labelFor(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

function hrefFor(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "task":
      return `/tasks?task=${encodeURIComponent(entityId)}`;
    case "note":
      return `/notes?note=${encodeURIComponent(entityId)}`;
    case "capture":
    case "capture_item":
      return `/inbox?capture=${encodeURIComponent(entityId)}`;
    case "connector":
      return "/connectors";
    case "person":
      return `/people?person=${encodeURIComponent(entityId)}`;
    case "knowledge":
      return `/knowledge?item=${encodeURIComponent(entityId)}`;
    case "document":
      return `/documents?doc=${encodeURIComponent(entityId)}`;
    case "query":
      return "/ask";
    case "waiting_item":
      return `/waiting/${encodeURIComponent(entityId)}`;
    case "attention_item":
      return `/deadlines?item=${encodeURIComponent(entityId)}`;
    default:
      return null;
  }
}

function toDto(row: AuditLogEntry): AuditEntryDto {
  return {
    id: row.id,
    action: row.action,
    label: labelFor(row.action),
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    href: hrefFor(row.entityType ?? null, row.entityId ?? null),
    metadata: row.metadata ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

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

export async function listAuditLogForUser(
  userId: string,
  opts?: { limit?: number; action?: string },
): Promise<AuditEntryDto[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const where = opts?.action
    ? and(eq(auditLog.userId, userId), eq(auditLog.action, opts.action))
    : eq(auditLog.userId, userId);

  const rows = await getDb()
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return rows.map(toDto);
}
