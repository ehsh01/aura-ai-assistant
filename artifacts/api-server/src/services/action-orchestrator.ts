import { routeIntentForText, type IntentRouteDecision } from "./intent-router";
import type { ClassifyIntentResult } from "../prompts/classifyIntent.v1";
import { aiService, type CaptureClassificationItem } from "./ai";
import { queryRecallForUser, type QueryAnswer } from "./query-engine";
import { createCaptureForUser, updateCaptureStatusForUser } from "./captures";
import { queueCaptureExtraction, ingestCaptureForUser } from "./capture-pipeline";
import { createTaskForUser } from "./tasks";
import {
  upsertAttentionItemForUser,
  dueAtFromDateString,
  type AttentionKind,
} from "./attention";
import { createMemoryForUser } from "./life-memory";
import { createNoteForUser } from "./notes";
import { createEvidenceForUser } from "./evidence";
import { writeAuditLog } from "./audit";

/**
 * Action Orchestrator (Milestone 2)
 *
 * Bridges a single classified Ask input to the app's EXISTING domain services.
 * It never invents a parallel task/reminder/memory system — it maps a proposed
 * action to `createTaskForUser`, `upsertAttentionItemForUser`, `createMemoryForUser`,
 * `createNoteForUser`, or the capture pipeline.
 *
 * Two phases (stateless):
 *   1. `planActionsForText` — classify, answer questions, and DRAFT proposed
 *      actions for captures (nothing is written except the raw source, which is
 *      always preserved). Mixed inputs get both an answer and draft cards.
 *   2. `confirmProposedAction` — execute one user-confirmed draft via the
 *      existing service, link evidence back to the raw capture, and audit it.
 */

export type ProposedActionType =
  | "create_task"
  | "create_reminder"
  | "save_memory"
  | "create_note"
  | "send_to_inbox";

export interface ProposedActionDraft {
  title: string;
  content: string;
  /** YYYY-MM-DD or ISO datetime; null when no date was detected. */
  dueAt: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  tags: string[];
  /** Life-memory domain; null lets the memory service auto-classify. */
  domain: string | null;
  /** Attention kind for reminders. */
  kind: AttentionKind | null;
}

export interface ProposedAction {
  id: string;
  type: ProposedActionType;
  /** Human label for the card header, e.g. "Save as memory". */
  label: string;
  draft: ProposedActionDraft;
  confidence: number;
  reason: string;
}

const ACTION_LABELS: Record<ProposedActionType, string> = {
  create_task: "Add task",
  create_reminder: "Reminder",
  save_memory: "Save as memory",
  create_note: "Save note",
  send_to_inbox: "Send to Inbox",
};

function firstLine(text: string): string {
  const line = text.trim().split(/\r?\n/, 1)[0] ?? text.trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

/** Map an inbox/extraction suggestedType to an action when the intent is generic. */
function fromSuggestedType(
  suggestedType: CaptureClassificationItem["suggestedType"],
  intent: ClassifyIntentResult,
): ProposedActionType {
  if (intent.containsDurableFact) return "save_memory";
  switch (suggestedType) {
    case "task":
    case "project_item":
      return "create_task";
    case "reminder":
      return "create_reminder";
    case "note":
    case "work_note":
    case "reference":
      return "create_note";
    default:
      return "send_to_inbox";
  }
}

/** Choose the primary action type from the intent, falling back to extraction. */
function primaryActionType(
  intent: ClassifyIntentResult,
  classification: CaptureClassificationItem,
): ProposedActionType {
  switch (intent.primaryIntent) {
    case "task":
      return "create_task";
    case "reminder":
      return "create_reminder";
    case "memory":
      return "save_memory";
    case "note":
      return "create_note";
    // Intents with no safe first-class create surface today → review in Inbox
    // (never silently create a second system for people/projects/finance).
    case "person_update":
    case "project_update":
    case "document":
    case "finance_record":
    case "waiting_on":
    case "command":
      return "send_to_inbox";
    default:
      return fromSuggestedType(classification.suggestedType, intent);
  }
}

/**
 * PURE mapping: given the classified intent and the (existing) capture
 * extraction, produce the proposed action cards. No side effects — unit tested.
 */
export function draftProposedActions(
  text: string,
  intent: ClassifyIntentResult,
  classification: CaptureClassificationItem,
): ProposedAction[] {
  const title = classification.cleanedTitle?.trim() || firstLine(text);
  const priority = classification.suggestedPriority ?? "medium";
  const tags = Array.isArray(classification.suggestedTags) ? classification.suggestedTags : [];
  const dueAt = classification.suggestedDueDate ?? null;

  const primaryType = primaryActionType(intent, classification);
  const baseDraft: ProposedActionDraft = {
    title,
    content: text.trim(),
    dueAt,
    priority,
    tags,
    domain: null,
    kind: primaryType === "create_reminder" ? "follow_up" : null,
  };

  const actions: ProposedAction[] = [
    {
      id: "action-0",
      type: primaryType,
      label: ACTION_LABELS[primaryType],
      draft: baseDraft,
      confidence: intent.confidence,
      reason: intent.reason || "Primary intent",
    },
  ];

  // Multi-intent fan-out: if the input also states a durable fact but the
  // primary action isn't a memory, offer a second "save as memory" card.
  if (intent.containsDurableFact && primaryType !== "save_memory") {
    actions.push({
      id: "action-1",
      type: "save_memory",
      label: ACTION_LABELS.save_memory,
      draft: { ...baseDraft, kind: null },
      confidence: intent.confidence,
      reason: "Also contains a durable fact",
    });
  }

  return actions;
}

export interface PlanRouting {
  route: IntentRouteDecision["route"];
  source: IntentRouteDecision["source"];
  degraded: boolean;
  primaryIntent: ClassifyIntentResult["primaryIntent"];
  secondaryIntents: ClassifyIntentResult["secondaryIntents"];
  confidence: number;
  requiresConfirmation: boolean;
  reason: string;
}

export interface PlanResult {
  mode: "answer" | "review";
  routing: PlanRouting;
  /** Present for questions and for mixed inputs (question + capture). */
  answer: QueryAnswer | null;
  actions: ProposedAction[];
  /** Raw capture id (source preservation) for capture/mixed inputs. */
  rawCaptureId: string | null;
}

function publicRouting(decision: IntentRouteDecision): PlanRouting {
  return {
    route: decision.route,
    source: decision.source,
    degraded: decision.degraded,
    primaryIntent: decision.result.primaryIntent,
    secondaryIntents: decision.result.secondaryIntents,
    confidence: decision.result.confidence,
    requiresConfirmation: decision.result.requiresConfirmation,
    reason: decision.result.reason,
  };
}

/** Classify one input and either answer it or draft proposed capture actions. */
export async function planActionsForText(
  userId: string,
  text: string,
  opts?: { threadId?: string | null },
): Promise<PlanResult> {
  const threadId = opts?.threadId ?? null;
  const decision = await routeIntentForText(text);

  if (decision.route === "question") {
    const answer = await queryRecallForUser(userId, text, { threadId });
    await writeAuditLog({
      userId,
      action: "ask_input_planned",
      entityType: "query",
      metadata: { route: "question", primaryIntent: decision.result.primaryIntent },
    });
    return { mode: "answer", routing: publicRouting(decision), answer, actions: [], rawCaptureId: null };
  }

  // Capture route: always preserve the raw source first.
  const raw = await createCaptureForUser(userId, {
    rawText: text,
    sourceType: "ask",
    sourceName: "Ask",
    rawMetadata: {
      askThreadId: threadId,
      intent: {
        primaryIntent: decision.result.primaryIntent,
        secondaryIntents: decision.result.secondaryIntents,
        confidence: decision.result.confidence,
        source: decision.source,
      },
    },
  });

  const classification = (await aiService.classifyCapture({ rawText: text })).item;
  const actions = draftProposedActions(text, decision.result, classification);

  // Mixed input: also answer the embedded question inline.
  const answer = decision.result.containsQuestion
    ? await queryRecallForUser(userId, text, { threadId })
    : null;

  await writeAuditLog({
    userId,
    action: "ask_input_planned",
    entityType: "capture",
    entityId: raw.id,
    metadata: {
      route: "capture",
      primaryIntent: decision.result.primaryIntent,
      actionCount: actions.length,
      mixed: Boolean(answer),
      source: decision.source,
    },
  });

  return { mode: "review", routing: publicRouting(decision), answer, actions, rawCaptureId: raw.id };
}

export interface ConfirmActionInput {
  type: ProposedActionType;
  draft: ProposedActionDraft;
  rawCaptureId?: string | null;
  threadId?: string | null;
}

export interface ConfirmActionResult {
  entityType: string;
  entityId: string;
  /** True when a reminder had no explicit date and a default time was applied. */
  usedDefaultDueAt?: boolean;
}

/** Default reminder time when the user gave no date: tomorrow at 9:00 AM. */
export function defaultReminderDue(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

/** Map our draft priority to the task service's accepted values. */
function taskPriority(p: ProposedActionDraft["priority"]): "high" | "med" | "medium" | "low" | "none" {
  if (p === "urgent" || p === "high") return "high";
  if (p === "medium") return "medium";
  if (p === "low") return "low";
  return "none";
}

async function linkEvidence(
  userId: string,
  entityType: string,
  entityId: string,
  draft: ProposedActionDraft,
  rawCaptureId: string | null | undefined,
): Promise<void> {
  if (!rawCaptureId) return;
  await createEvidenceForUser(userId, {
    entityType,
    entityId,
    claimType: "created_from_ask",
    sourceCaptureId: rawCaptureId,
    evidenceText: draft.content.slice(0, 500),
    evidenceMetadata: { via: "ask_action_confirmed" },
  });
  await updateCaptureStatusForUser(userId, rawCaptureId, { processedStatus: "processed" });
}

/** Execute one confirmed proposed action via the existing domain service. */
export async function confirmProposedAction(
  userId: string,
  input: ConfirmActionInput,
): Promise<ConfirmActionResult> {
  const { draft, rawCaptureId, type } = input;
  let result: ConfirmActionResult;

  switch (type) {
    case "create_task": {
      const task = await createTaskForUser(userId, {
        title: draft.title,
        time: draft.dueAt ?? null,
        priority: taskPriority(draft.priority),
        tags: draft.tags,
        sourceCaptureId: rawCaptureId ?? null,
        aiGenerated: true,
        userConfirmed: true,
      });
      await linkEvidence(userId, "task", task.id, draft, rawCaptureId);
      result = { entityType: "task", entityId: task.id };
      break;
    }
    case "create_reminder": {
      // A reminder must be a real, visible attention item. If no date was given,
      // apply a sensible default (tomorrow 9am) instead of silently dropping it
      // into an undated task the user can never find.
      const explicitDue = draft.dueAt ? dueAtFromDateString(draft.dueAt) : null;
      const due = explicitDue ?? defaultReminderDue();
      const item = await upsertAttentionItemForUser(userId, {
        title: draft.title,
        summary: draft.content.slice(0, 300),
        dueAt: due,
        kind: draft.kind ?? "follow_up",
        sourceEntityType: "capture",
        sourceEntityId: rawCaptureId ?? `ask-${Date.now()}`,
        evidenceText: draft.content.slice(0, 300),
        confidence: draft.priority === "urgent" ? 0.9 : 0.8,
        metadata: { via: "ask" },
      });
      if (rawCaptureId) {
        await updateCaptureStatusForUser(userId, rawCaptureId, { processedStatus: "processed" });
      }
      result = { entityType: "attention_item", entityId: item.id, usedDefaultDueAt: !explicitDue };
      break;
    }
    case "save_memory": {
      const memory = await createMemoryForUser(userId, {
        content: draft.content,
        domain: draft.domain,
        tags: draft.tags,
        sourceType: "ask",
        sourceId: rawCaptureId ?? null,
      });
      await linkEvidence(userId, "memory", memory.id, draft, rawCaptureId);
      result = { entityType: "memory", entityId: memory.id };
      break;
    }
    case "create_note": {
      const note = await createNoteForUser(userId, {
        title: draft.title,
        content: draft.content,
        tags: draft.tags,
      });
      await linkEvidence(userId, "note", note.id, draft, rawCaptureId);
      result = { entityType: "note", entityId: note.id };
      break;
    }
    case "send_to_inbox": {
      if (rawCaptureId) {
        const { jobId } = await queueCaptureExtraction(userId, rawCaptureId);
        result = { entityType: "capture", entityId: rawCaptureId };
        await writeAuditLog({
          userId,
          action: "ask_action_confirmed",
          entityType: "capture",
          entityId: rawCaptureId,
          metadata: { type, jobId },
        });
        return result;
      }
      const { capture } = await ingestCaptureForUser(userId, {
        rawText: draft.content,
        sourceType: "ask",
        sourceName: "Ask",
      });
      result = { entityType: "capture", entityId: capture.id };
      break;
    }
    default: {
      const exhaustive: never = type;
      throw new Error(`Unknown action type: ${String(exhaustive)}`);
    }
  }

  await writeAuditLog({
    userId,
    action: "ask_action_confirmed",
    entityType: result.entityType,
    entityId: result.entityId,
    metadata: { type, rawCaptureId: rawCaptureId ?? null, usedDefaultDueAt: result.usedDefaultDueAt ?? false },
  });

  return result;
}
