import { and, desc, eq, lt } from "drizzle-orm";
import { captureItems, captures, type CaptureItem, type CaptureSuggestedLink } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newCaptureId } from "../lib/recall-format";
import { createEvidenceForUser } from "./evidence";
import { createMemoryForUser, type LifeMemoryDto } from "./life-memory";
import { createNoteForUser, type RecallNoteDto } from "./notes";
import {
  getPersonForUser,
  listPeopleForUser,
  resolvePersonByName,
  type PersonDto,
} from "./people";
import { recordUserCorrection } from "./user-corrections";
import { createTaskForUser, type RecallTaskDto } from "./tasks";
import { extractPerson, matchPersonId } from "./waiting-on";
import { listPersonNameAliases, peopleWithAliasNames } from "./user-corrections";
import { writeAuditLog } from "./audit";
import { captureConfidenceLabel } from "./capture-classify";

export type CaptureSuggestedType =
  | "note"
  | "task"
  | "reminder"
  | "work_note"
  | "project_item"
  | "reference";

export type CaptureSuggestedPriority = "low" | "medium" | "high" | "urgent";
export type CaptureStatus = "pending" | "accepted" | "dismissed" | "snoozed";

export type RecallCaptureItemDto = {
  id: string;
  rawCaptureId: string | null;
  rawText: string;
  cleanedTitle: string;
  suggestedType: CaptureSuggestedType;
  suggestedPriority: CaptureSuggestedPriority;
  suggestedDueDate: string | null;
  suggestedProject: string | null;
  suggestedTags: string[];
  suggestedActions: string[];
  /** Computed at read time from capture text + known people. */
  suggestedPersonName: string | null;
  status: CaptureStatus;
  projectId: string | null;
  notebookId: string | null;
  /** Classification confidence 0..1 (null for legacy rows). */
  confidence: number | null;
  confidenceLabel: "high" | "needs_review" | "uncertain";
  /** Raw capture source, joined at read time (null for legacy inline items). */
  sourceType: string | null;
  sourceUrl: string | null;
  /** Match-only link suggestions — never silently created. */
  suggestedLinks: CaptureSuggestedLink[];
  snoozedUntil: string | null;
  /** True when Aura auto-organized the capture (high confidence, low risk). */
  autoAccepted: boolean;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CaptureClassification = Pick<
  RecallCaptureItemDto,
  | "cleanedTitle"
  | "suggestedType"
  | "suggestedPriority"
  | "suggestedDueDate"
  | "suggestedProject"
  | "suggestedTags"
  | "suggestedActions"
>;

export type CreateCaptureInput = {
  rawText: string;
  mode?: "inbox" | "note" | "task";
  dueDate?: string | null;
  projectId?: string | null;
  notebookId?: string | null;
  tags?: string[];
  classification?: Partial<CaptureClassification>;
};

export type UpdateCaptureInput = Partial<
  Omit<
    RecallCaptureItemDto,
    | "id"
    | "attachmentCount"
    | "createdAt"
    | "updatedAt"
    | "confidence"
    | "confidenceLabel"
    | "sourceType"
    | "sourceUrl"
    | "suggestedLinks"
    | "autoAccepted"
  >
>;

export type AcceptCaptureInput = {
  type?: CaptureSuggestedType;
  title?: string;
  content?: string;
  dueDate?: string | null;
  projectId?: string | null;
  notebookId?: string | null;
  tags?: string[];
  personId?: string | null;
  personName?: string | null;
  /** Skip person linking even if text mentions a name. */
  skipPerson?: boolean;
  /** Save as permanent life memory instead of a note. */
  saveAsMemory?: boolean;
  memoryDomain?: string | null;
};

export type AcceptCaptureResult = {
  item: RecallCaptureItemDto;
  note?: RecallNoteDto;
  task?: RecallTaskDto;
  memory?: LifeMemoryDto;
  personId?: string | null;
  personName?: string | null;
};

/**
 * Resolve a person for inbox accept: explicit id/name, else extract from text.
 * Creates the person when a confident name is found and none exists yet.
 */
export async function resolvePersonForAccept(
  userId: string,
  input: {
    personId?: string | null;
    personName?: string | null;
    title: string;
    rawText: string;
    /** When true, do not auto-extract a person from text. */
    skipPerson?: boolean;
  },
): Promise<PersonDto | null> {
  if (input.personId) {
    const byId = await getPersonForUser(userId, input.personId);
    if (byId) return byId;
  }

  const [people, aliases] = await Promise.all([
    listPeopleForUser(userId),
    listPersonNameAliases(userId),
  ]);
  const peopleForMatch = peopleWithAliasNames(people, aliases);
  const peopleNames = peopleForMatch.map((p) => p.displayName);

  // Explicit empty / null personName means the user cleared the suggestion.
  if (input.skipPerson || input.personName === null || input.personName === "") {
    return null;
  }

  const explicit = input.personName?.trim();
  if (explicit && explicit.toLowerCase() !== "someone") {
    const matched = matchPersonId(explicit, people, aliases);
    if (matched) {
      const hit = people.find((p) => p.id === matched);
      if (hit) return hit;
    }
    return resolvePersonByName(userId, explicit);
  }

  const blob = `${input.title}\n${input.rawText}`;
  const extracted = extractPerson(blob, peopleNames);
  if (!extracted || extracted === "Someone") return null;

  const matched = matchPersonId(extracted, people, aliases);
  if (matched) {
    const hit = people.find((p) => p.id === matched);
    if (hit) return hit;
  }
  return resolvePersonByName(userId, extracted);
}

function normalizeType(type?: string): CaptureSuggestedType {
  if (
    type === "task" ||
    type === "reminder" ||
    type === "work_note" ||
    type === "project_item" ||
    type === "reference"
  ) {
    return type;
  }
  return "note";
}

function normalizePriority(priority?: string): CaptureSuggestedPriority {
  if (priority === "urgent" || priority === "high" || priority === "low") return priority;
  return "medium";
}

function cleanTitle(text: string): string {
  const firstLine = text.trim().split(/\r?\n/).find(Boolean) ?? "Untitled capture";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

export function classifyCaptureDeterministically(
  rawText: string,
  input?: Pick<CreateCaptureInput, "dueDate" | "projectId" | "tags">,
): CaptureClassification {
  const lower = rawText.toLowerCase();
  const isTask = /\b(todo|task|call|email|follow up|remind|schedule|send|check|fix)\b/.test(lower);
  const isReminder = /\b(remind|due|tomorrow|today|next week|appointment)\b/.test(lower);
  const isWork = /\b(ticket|user|vpn|printer|outlook|email|server|network|troubleshoot|support)\b/.test(lower);
  const isProject = /\b(permit|inspection|contractor|construction|project|city of miami)\b/.test(lower);
  const urgent = /\b(urgent|asap|critical|emergency|blocked|down)\b/.test(lower);
  const high = urgent || /\b(follow up|waiting|call|deadline|due today)\b/.test(lower);

  const suggestedType: CaptureSuggestedType = isReminder
    ? "reminder"
    : isTask
      ? "task"
      : isWork
        ? "work_note"
        : isProject
          ? "project_item"
          : "note";

  const tags = new Set(input?.tags ?? []);
  if (isWork) tags.add("work");
  if (isProject) tags.add("project");
  if (isReminder) tags.add("reminder");
  if (high) tags.add("follow-up");

  const actions: string[] = [];
  if (isTask || isReminder) actions.push("Create task");
  if (isWork) actions.push("Generate IT work note");
  if (isProject) actions.push("Attach to project");

  return {
    cleanedTitle: cleanTitle(rawText),
    suggestedType,
    suggestedPriority: urgent ? "urgent" : high ? "high" : "medium",
    suggestedDueDate: input?.dueDate ?? null,
    suggestedProject: null,
    suggestedTags: Array.from(tags),
    suggestedActions: actions,
  };
}

function suggestPersonName(
  title: string,
  rawText: string,
  peopleNames: string[],
): string | null {
  const name = extractPerson(`${title}\n${rawText}`, peopleNames);
  return !name || name === "Someone" ? null : name;
}

function toDto(
  row: CaptureItem,
  peopleNames: string[] = [],
  source?: { sourceType: string | null; sourceUrl: string | null },
): RecallCaptureItemDto {
  return {
    id: row.id,
    rawCaptureId: row.rawCaptureId ?? null,
    rawText: row.rawText,
    cleanedTitle: row.cleanedTitle,
    suggestedType: normalizeType(row.suggestedType),
    suggestedPriority: normalizePriority(row.suggestedPriority),
    suggestedDueDate: row.suggestedDueDate ?? null,
    suggestedProject: row.suggestedProject ?? null,
    suggestedTags: row.suggestedTags ?? [],
    suggestedActions: row.suggestedActions ?? [],
    suggestedPersonName: suggestPersonName(row.cleanedTitle, row.rawText, peopleNames),
    status:
      row.status === "accepted" || row.status === "dismissed" || row.status === "snoozed"
        ? row.status
        : "pending",
    projectId: row.projectId ?? null,
    notebookId: row.notebookId ?? null,
    confidence: row.confidence ?? null,
    confidenceLabel: captureConfidenceLabel(row.confidence),
    sourceType: source?.sourceType ?? null,
    sourceUrl: source?.sourceUrl ?? null,
    suggestedLinks: row.suggestedLinks ?? [],
    snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    autoAccepted: row.metadata?.autoAccepted === true,
    attachmentCount: 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function peopleNamesForUser(userId: string): Promise<string[]> {
  const people = await listPeopleForUser(userId);
  return people.map((p) => p.displayName);
}

export async function createCaptureForUser(
  userId: string,
  input: CreateCaptureInput & { rawCaptureId?: string | null },
): Promise<RecallCaptureItemDto> {
  const fallback = classifyCaptureDeterministically(input.rawText, input);
  const classification = { ...fallback, ...input.classification };
  const now = new Date();
  const [row] = await getDb()
    .insert(captureItems)
    .values({
      id: newCaptureId(),
      userId,
      rawCaptureId: input.rawCaptureId ?? null,
      rawText: input.rawText,
      cleanedTitle: classification.cleanedTitle ?? fallback.cleanedTitle,
      suggestedType: normalizeType(classification.suggestedType),
      suggestedPriority: normalizePriority(classification.suggestedPriority),
      suggestedDueDate: classification.suggestedDueDate ?? input.dueDate ?? null,
      suggestedProject: classification.suggestedProject ?? null,
      suggestedTags: classification.suggestedTags ?? [],
      suggestedActions: classification.suggestedActions ?? [],
      status: "pending",
      projectId: input.projectId ?? null,
      notebookId: input.notebookId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const peopleNames = await peopleNamesForUser(userId);
  return toDto(row!, peopleNames);
}

export async function listCaptureInboxForUser(userId: string): Promise<RecallCaptureItemDto[]> {
  const db = getDb();
  // Auto-clear stale pending captures so Home/Inbox stay focused on recent items.
  const cutoff = new Date(Date.now() - 2 * 86_400_000);
  await db
    .update(captureItems)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(
      and(
        eq(captureItems.userId, userId),
        eq(captureItems.status, "pending"),
        lt(captureItems.createdAt, cutoff),
      ),
    );

  // Resurface snoozed items whose time has come — self-healing, no cron needed.
  await db
    .update(captureItems)
    .set({ status: "pending", snoozedUntil: null, updatedAt: new Date() })
    .where(
      and(
        eq(captureItems.userId, userId),
        eq(captureItems.status, "snoozed"),
        lt(captureItems.snoozedUntil, new Date()),
      ),
    );

  const [rows, peopleNames] = await Promise.all([
    db
      .select({
        item: captureItems,
        sourceType: captures.sourceType,
        sourceUrl: captures.sourceUrl,
      })
      .from(captureItems)
      .leftJoin(captures, eq(captureItems.rawCaptureId, captures.id))
      .where(and(eq(captureItems.userId, userId), eq(captureItems.status, "pending")))
      .orderBy(desc(captureItems.updatedAt)),
    peopleNamesForUser(userId),
  ]);
  return rows.map((row) =>
    toDto(row.item, peopleNames, { sourceType: row.sourceType, sourceUrl: row.sourceUrl }),
  );
}

export async function updateCaptureForUser(
  userId: string,
  captureId: string,
  input: UpdateCaptureInput,
): Promise<RecallCaptureItemDto | null> {
  const existingRows = await getDb()
    .select()
    .from(captureItems)
    .where(and(eq(captureItems.id, captureId), eq(captureItems.userId, userId)))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) return null;

  if (input.status !== undefined && input.status !== existing.status) {
    await recordUserCorrection(userId, {
      entityType: "capture_item",
      entityId: captureId,
      fieldName: "status",
      oldValue: existing.status,
      newValue: input.status,
    });
  }

  // Snooze defaults to +24h when no explicit time is given; leaving snooze
  // (back to pending or any terminal status) clears the timer.
  const snoozedUntil =
    input.status === "snoozed"
      ? input.snoozedUntil
        ? new Date(input.snoozedUntil)
        : new Date(Date.now() + 86_400_000)
      : input.status !== undefined
        ? null
        : input.snoozedUntil !== undefined
          ? input.snoozedUntil
            ? new Date(input.snoozedUntil)
            : null
          : undefined;

  const [row] = await getDb()
    .update(captureItems)
    .set({
      ...(input.rawText !== undefined ? { rawText: input.rawText } : {}),
      ...(input.cleanedTitle !== undefined ? { cleanedTitle: input.cleanedTitle } : {}),
      ...(input.suggestedType !== undefined ? { suggestedType: normalizeType(input.suggestedType) } : {}),
      ...(input.suggestedPriority !== undefined
        ? { suggestedPriority: normalizePriority(input.suggestedPriority) }
        : {}),
      ...(input.suggestedDueDate !== undefined ? { suggestedDueDate: input.suggestedDueDate } : {}),
      ...(input.suggestedProject !== undefined ? { suggestedProject: input.suggestedProject } : {}),
      ...(input.suggestedTags !== undefined ? { suggestedTags: input.suggestedTags } : {}),
      ...(input.suggestedActions !== undefined ? { suggestedActions: input.suggestedActions } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(snoozedUntil !== undefined ? { snoozedUntil } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.notebookId !== undefined ? { notebookId: input.notebookId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(captureItems.id, captureId), eq(captureItems.userId, userId)))
    .returning();

  if (row && input.status === "dismissed" && existing.status !== "dismissed") {
    await writeAuditLog({
      userId,
      action: "capture_dismissed",
      entityType: "capture_item",
      entityId: captureId,
      metadata: { title: row.cleanedTitle },
    });
  }

  if (row && input.status === "snoozed" && existing.status !== "snoozed") {
    await writeAuditLog({
      userId,
      action: "capture_snoozed",
      entityType: "capture_item",
      entityId: captureId,
      metadata: { title: row.cleanedTitle, snoozedUntil: row.snoozedUntil?.toISOString() ?? null },
    });
  }

  return row ? toDto(row, await peopleNamesForUser(userId)) : null;
}

export async function acceptCaptureForUser(
  userId: string,
  captureId: string,
  input: AcceptCaptureInput,
): Promise<AcceptCaptureResult | null> {
  const rows = await getDb()
    .select()
    .from(captureItems)
    .where(and(eq(captureItems.id, captureId), eq(captureItems.userId, userId)))
    .limit(1);
  const existing = rows[0];
  if (!existing) return null;

  const peopleNames = await peopleNamesForUser(userId);
  const item = toDto(existing, peopleNames);
  if (existing.status === "accepted") {
    return { item };
  }
  const type = normalizeType(input.type ?? item.suggestedType);
  const title = input.title?.trim() || item.cleanedTitle;
  const content = input.content ?? item.rawText;
  const tags = [...(input.tags ?? item.suggestedTags)];
  const projectId = input.projectId ?? item.projectId;
  const notebookId = input.notebookId ?? item.notebookId;

  const person = await resolvePersonForAccept(userId, {
    personId: input.personId,
    personName: input.personName,
    title,
    rawText: item.rawText,
    skipPerson: input.skipPerson === true,
  });
  if (person) {
    const personTag = `person:${person.displayName}`;
    if (!tags.some((t) => t.toLowerCase() === personTag.toLowerCase())) {
      tags.push(personTag);
    }
  }

  let note: RecallNoteDto | undefined;
  let task: RecallTaskDto | undefined;
  let memory: LifeMemoryDto | undefined;

  if (input.saveAsMemory) {
    memory = await createMemoryForUser(userId, {
      title,
      content,
      domain: input.memoryDomain ?? null,
      tags,
      primaryPersonId: person?.id ?? null,
      projectId,
      sourceType: "capture",
      sourceId: item.rawCaptureId ?? captureId,
    });
    if (memory && item.rawCaptureId) {
      await createEvidenceForUser(userId, {
        entityType: "memory",
        entityId: memory.id,
        claimType: "summary_based_on",
        sourceCaptureId: item.rawCaptureId,
        evidenceText: item.rawText.slice(0, 500),
        evidenceMetadata: person
          ? { personId: person.id, personName: person.displayName }
          : undefined,
      });
    }
  } else if (type === "task" || type === "reminder") {
    task = await createTaskForUser(userId, {
      title,
      time: input.dueDate ?? item.suggestedDueDate,
      priority: item.suggestedPriority === "urgent" ? "high" : item.suggestedPriority,
      tags,
      projectId,
      sourceCaptureId: item.rawCaptureId,
      requesterPersonId: person?.id ?? null,
      aiGenerated: Boolean(item.rawCaptureId),
      userConfirmed: true,
    });
    if (task && item.rawCaptureId) {
      await createEvidenceForUser(userId, {
        entityType: "task",
        entityId: task.id,
        claimType: "task_created_from",
        sourceCaptureId: item.rawCaptureId,
        evidenceText: item.rawText.slice(0, 500),
        evidenceMetadata: person
          ? { personId: person.id, personName: person.displayName }
          : undefined,
      });
    }
  } else {
    note = await createNoteForUser(userId, {
      title,
      content,
      tags,
      projectId,
      notebookId,
      primaryPersonId: person?.id ?? null,
    });
    if (note && item.rawCaptureId) {
      await createEvidenceForUser(userId, {
        entityType: "note",
        entityId: note.id,
        claimType: "summary_based_on",
        sourceCaptureId: item.rawCaptureId,
        evidenceText: item.rawText.slice(0, 500),
        evidenceMetadata: person
          ? { personId: person.id, personName: person.displayName }
          : undefined,
      });
    }
  }

  const updated = await updateCaptureForUser(userId, captureId, { status: "accepted" });
  if (updated) {
    await writeAuditLog({
      userId,
      action: "capture_accepted",
      entityType: memory ? "memory" : task ? "task" : "note",
      entityId: memory?.id ?? task?.id ?? note?.id ?? captureId,
      metadata: {
        captureItemId: captureId,
        type: memory ? "memory" : type,
        title,
        createdTaskId: task?.id ?? null,
        createdNoteId: note?.id ?? null,
        createdMemoryId: memory?.id ?? null,
        sourceCaptureId: item.rawCaptureId,
        personId: person?.id ?? null,
        personName: person?.displayName ?? null,
      },
    });
  }
  return updated
    ? {
        item: updated,
        note,
        task,
        memory,
        personId: person?.id ?? null,
        personName: person?.displayName ?? null,
      }
    : null;
}
