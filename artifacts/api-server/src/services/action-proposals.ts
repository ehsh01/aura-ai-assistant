/**
 * Durable action proposals (Voice First Milestone 5).
 *
 * Plan returns ephemeral action cards today; this module persists them so
 * confirm / correct / cancel are server-authoritative and idempotent.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { actionProposals, type ActionProposalStatus } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newActionProposalId } from "../lib/recall-format";
import { writeAuditLog } from "./audit";
import type { ProposedAction, ProposedActionDraft, ProposedActionType } from "./action-orchestrator";
import { resolveTemporalExpression } from "./voice-first/temporal";

export type ProposalDto = {
  id: string;
  type: ProposedActionType;
  label: string;
  draft: ProposedActionDraft;
  confidence: number;
  reason: string;
  status: ActionProposalStatus;
  version: number;
  threadId: string | null;
  captureId: string | null;
  supersedesId: string | null;
  executedEntityType: string | null;
  executedEntityId: string | null;
};

function toDto(row: typeof actionProposals.$inferSelect): ProposalDto {
  return {
    id: row.id,
    type: row.actionType as ProposedActionType,
    label: row.label,
    draft: row.draft as unknown as ProposedActionDraft,
    confidence: row.confidence,
    reason: row.explanation,
    status: row.status as ActionProposalStatus,
    version: row.version,
    threadId: row.threadId,
    captureId: row.captureId,
    supersedesId: row.supersedesId,
    executedEntityType: row.executedEntityType,
    executedEntityId: row.executedEntityId,
  };
}

function asProposedAction(dto: ProposalDto): ProposedAction {
  return {
    id: dto.id,
    type: dto.type,
    label: dto.label,
    draft: dto.draft,
    confidence: dto.confidence,
    reason: dto.reason,
  };
}

export async function persistProposedActions(input: {
  userId: string;
  threadId?: string | null;
  captureId?: string | null;
  actions: ProposedAction[];
  idempotencyKey?: string | null;
}): Promise<ProposedAction[]> {
  if (input.actions.length === 0) return [];

  // Idempotent re-plan with the same key: return existing open proposals.
  if (input.idempotencyKey) {
    const existing = await getDb()
      .select()
      .from(actionProposals)
      .where(
        and(
          eq(actionProposals.userId, input.userId),
          eq(actionProposals.idempotencyKey, input.idempotencyKey),
        ),
      )
      .orderBy(desc(actionProposals.createdAt));
    const open = existing.filter((r) => r.status === "proposed");
    if (open.length > 0) return open.map((r) => asProposedAction(toDto(r)));
  }

  // Supersede any still-open proposals on this thread so only one set is active.
  if (input.threadId) {
    await getDb()
      .update(actionProposals)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(
        and(
          eq(actionProposals.userId, input.userId),
          eq(actionProposals.threadId, input.threadId),
          eq(actionProposals.status, "proposed"),
        ),
      );
  }

  const out: ProposedAction[] = [];
  for (const action of input.actions) {
    const id = action.id?.startsWith("aprop-") ? action.id : newActionProposalId();
    const now = new Date();
    await getDb().insert(actionProposals).values({
      id,
      userId: input.userId,
      threadId: input.threadId ?? null,
      captureId: input.captureId ?? null,
      actionType: action.type,
      label: action.label,
      draft: action.draft as unknown as Record<string, unknown>,
      explanation: action.reason,
      confidence: action.confidence,
      riskLevel: "low",
      confirmationRequired: true,
      status: "proposed",
      version: 1,
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: now,
      updatedAt: now,
    });
    out.push({ ...action, id });
  }

  await writeAuditLog({
    userId: input.userId,
    action: "action_proposals_created",
    entityType: "action_proposal",
    entityId: out[0]?.id ?? null,
    metadata: {
      count: out.length,
      threadId: input.threadId ?? null,
      captureId: input.captureId ?? null,
      types: out.map((a) => a.type),
    },
  });

  return out;
}

export async function getProposalForUser(
  userId: string,
  proposalId: string,
): Promise<ProposalDto | null> {
  const rows = await getDb()
    .select()
    .from(actionProposals)
    .where(and(eq(actionProposals.id, proposalId), eq(actionProposals.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function listOpenProposalsForThread(
  userId: string,
  threadId: string,
): Promise<ProposalDto[]> {
  const rows = await getDb()
    .select()
    .from(actionProposals)
    .where(
      and(
        eq(actionProposals.userId, userId),
        eq(actionProposals.threadId, threadId),
        eq(actionProposals.status, "proposed"),
      ),
    )
    .orderBy(desc(actionProposals.createdAt));
  return rows.map(toDto);
}

/**
 * Atomically claim a proposed row for execution. Returns null if already
 * executed/cancelled/superseded so a double-tap cannot create two tasks.
 */
export async function claimProposalForConfirm(
  userId: string,
  proposalId: string,
): Promise<ProposalDto | null> {
  const rows = await getDb()
    .update(actionProposals)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(
      and(
        eq(actionProposals.id, proposalId),
        eq(actionProposals.userId, userId),
        eq(actionProposals.status, "proposed"),
      ),
    )
    .returning();
  return rows[0] ? toDto(rows[0]) : null;
}

export async function markProposalExecuted(
  userId: string,
  proposalId: string,
  result: { entityType: string; entityId: string },
): Promise<void> {
  await getDb()
    .update(actionProposals)
    .set({
      status: "executed",
      executedEntityType: result.entityType,
      executedEntityId: result.entityId,
      updatedAt: new Date(),
    })
    .where(and(eq(actionProposals.id, proposalId), eq(actionProposals.userId, userId)));
}

export async function markProposalFailed(userId: string, proposalId: string): Promise<void> {
  await getDb()
    .update(actionProposals)
    .set({ status: "failed", updatedAt: new Date() })
    .where(and(eq(actionProposals.id, proposalId), eq(actionProposals.userId, userId)));
}

export async function cancelProposalForUser(
  userId: string,
  proposalId: string,
): Promise<ProposalDto | null> {
  const rows = await getDb()
    .update(actionProposals)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(actionProposals.id, proposalId),
        eq(actionProposals.userId, userId),
        inArray(actionProposals.status, ["proposed", "confirmed"]),
      ),
    )
    .returning();
  const dto = rows[0] ? toDto(rows[0]) : null;
  if (dto) {
    await writeAuditLog({
      userId,
      action: "action_proposal_cancelled",
      entityType: "action_proposal",
      entityId: proposalId,
      metadata: { version: dto.version },
    });
  }
  return dto;
}

const CANCEL_RE =
  /\b(cancel( that| it| this)?|never ?mind|forget (it|that)|don't (do|make) (it|that)|scratch that)\b/i;

/**
 * Apply a natural-language correction to an open proposal.
 * Creates a new version (superseding the old) rather than mutating in place.
 */
export async function correctProposalForUser(
  userId: string,
  proposalId: string,
  correction: string,
  timezone = "America/New_York",
): Promise<
  | { ok: true; cancelled: true; proposal: ProposalDto }
  | { ok: true; cancelled: false; proposal: ProposalDto; action: ProposedAction }
  | { ok: false; error: string }
> {
  const current = await getProposalForUser(userId, proposalId);
  if (!current) return { ok: false, error: "Proposal not found" };
  if (current.status !== "proposed") {
    return { ok: false, error: `Proposal is ${current.status} and cannot be corrected` };
  }

  const text = correction.trim();
  if (!text) return { ok: false, error: "Correction text is required" };

  if (CANCEL_RE.test(text)) {
    const cancelled = await cancelProposalForUser(userId, proposalId);
    if (!cancelled) return { ok: false, error: "Could not cancel proposal" };
    return { ok: true, cancelled: true, proposal: cancelled };
  }

  const draft: ProposedActionDraft = { ...current.draft };
  let changed = false;

  const temporal = resolveTemporalExpression(text, {
    now: new Date(),
    timeZone: timezone,
  });
  if (temporal.dueAt) {
    draft.dueAt = temporal.dueAt;
    changed = true;
  }

  const taskToReminder = /\b(make (it|that) a reminder|as a reminder|remind me)\b/i.test(text);
  const reminderToTask = /\b(make (it|that) a task|as a task|add (it|that) as a task)\b/i.test(text);
  let nextType = current.type;
  if (taskToReminder && current.type === "create_task") {
    nextType = "create_reminder";
    changed = true;
  } else if (reminderToTask && current.type === "create_reminder") {
    nextType = "create_task";
    changed = true;
  }

  const titleMatch = text.match(/\b(?:title|call it|rename(?: it)? to)\s+["']?(.+?)["']?\s*$/i);
  if (titleMatch?.[1]?.trim()) {
    draft.title = titleMatch[1].trim().slice(0, 500);
    changed = true;
  }

  if (!changed) {
    return {
      ok: false,
      error:
        "I couldn't apply that correction. Try “make that Friday”, “cancel that”, or edit the fields.",
    };
  }

  // Supersede old, insert new version.
  await getDb()
    .update(actionProposals)
    .set({ status: "superseded", updatedAt: new Date() })
    .where(and(eq(actionProposals.id, proposalId), eq(actionProposals.userId, userId)));

  const newId = newActionProposalId();
  const now = new Date();
  const reason = temporal.explanation
    ? `${current.reason} Corrected: ${temporal.explanation}`
    : `${current.reason} Corrected by user.`;

  await getDb().insert(actionProposals).values({
    id: newId,
    userId,
    threadId: current.threadId,
    captureId: current.captureId,
    actionType: nextType,
    label: current.label,
    draft: draft as unknown as Record<string, unknown>,
    explanation: reason,
    confidence: current.confidence,
    riskLevel: "low",
    confirmationRequired: true,
    status: "proposed",
    version: current.version + 1,
    supersedesId: proposalId,
    createdAt: now,
    updatedAt: now,
  });

  const proposal = (await getProposalForUser(userId, newId))!;
  await writeAuditLog({
    userId,
    action: "action_proposal_corrected",
    entityType: "action_proposal",
    entityId: newId,
    metadata: {
      supersedesId: proposalId,
      version: proposal.version,
      correctionLength: text.length,
    },
  });

  return {
    ok: true,
    cancelled: false,
    proposal,
    action: asProposedAction(proposal),
  };
}
