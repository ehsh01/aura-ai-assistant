import { and, desc, eq, inArray } from "drizzle-orm";
import { people, tasks, type Task } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newTaskId } from "../lib/recall-format";
import { writeAuditLog } from "./audit";
import { warmEntityEmbedding } from "./embedding-cache";
import { syncPrimaryPersonLink } from "./entity-links";

export type RecallTaskDto = {
  id: string;
  title: string;
  time?: string;
  priority: "high" | "med" | "low" | "none";
  tags?: string[];
  completed: boolean;
  projectId: string | null;
  requesterPersonId: string | null;
  requesterPersonName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateTaskInput = {
  id?: string;
  title: string;
  time?: string | null;
  priority?: "high" | "med" | "medium" | "low" | "none";
  tags?: string[];
  completed?: boolean;
  projectId?: string | null;
  sourceCaptureId?: string | null;
  requesterPersonId?: string | null;
  aiGenerated?: boolean;
  userConfirmed?: boolean;
  confidenceScore?: number | null;
};

export type UpdateTaskInput = {
  title?: string;
  time?: string | null;
  priority?: "high" | "med" | "medium" | "low" | "none";
  tags?: string[];
  completed?: boolean;
  projectId?: string | null;
  requesterPersonId?: string | null;
};

function normalizePriority(
  priority?: string,
): "high" | "med" | "low" | "none" {
  if (priority === "high") return "high";
  if (priority === "med" || priority === "medium") return "med";
  if (priority === "low") return "low";
  return "none";
}

function toDto(row: Task, personName: string | null = null): RecallTaskDto {
  return {
    id: row.id,
    title: row.title,
    time: row.time ?? undefined,
    priority: normalizePriority(row.priority),
    tags: row.tags ?? [],
    completed: row.completed,
    projectId: row.projectId ?? null,
    requesterPersonId: row.requesterPersonId ?? null,
    requesterPersonName: personName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function personNamesById(
  userId: string,
  personIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(personIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const rows = await getDb()
    .select({ id: people.id, displayName: people.displayName })
    .from(people)
    .where(and(eq(people.userId, userId), inArray(people.id, unique)));
  for (const row of rows) map.set(row.id, row.displayName);
  return map;
}

export async function listTasksForUser(
  userId: string,
  options: { limit?: number } = {},
): Promise<RecallTaskDto[]> {
  const db = getDb();
  const query = db
    .select()
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .orderBy(desc(tasks.updatedAt));
  const rows = await (options.limit ? query.limit(options.limit) : query);
  const names = await personNamesById(
    userId,
    rows.map((r) => r.requesterPersonId).filter((id): id is string => Boolean(id)),
  );
  return rows.map((row) =>
    toDto(row, row.requesterPersonId ? names.get(row.requesterPersonId) ?? null : null),
  );
}

export async function createTaskForUser(
  userId: string,
  input: CreateTaskInput,
): Promise<RecallTaskDto> {
  const db = getDb();
  const now = new Date();
  const id = input.id?.trim() || newTaskId();

  let tags = [...(input.tags ?? [])];
  let personName: string | null = null;
  if (input.requesterPersonId) {
    const names = await personNamesById(userId, [input.requesterPersonId]);
    personName = names.get(input.requesterPersonId) ?? null;
    if (
      personName &&
      !tags.some((t) => t.toLowerCase() === `person:${personName}`.toLowerCase())
    ) {
      tags = [...tags.filter((t) => !/^person:/i.test(t)), `person:${personName}`];
    }
  }

  const [row] = await db
    .insert(tasks)
    .values({
      id,
      userId,
      projectId: input.projectId ?? null,
      sourceCaptureId: input.sourceCaptureId ?? null,
      requesterPersonId: input.requesterPersonId ?? null,
      aiGenerated: input.aiGenerated ?? false,
      userConfirmed: input.userConfirmed ?? false,
      confidenceScore: input.confidenceScore ?? null,
      title: input.title.trim(),
      time: input.time ?? null,
      priority: normalizePriority(input.priority),
      tags,
      completed: input.completed ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!personName && row?.requesterPersonId) {
    const names = await personNamesById(userId, [row.requesterPersonId]);
    personName = names.get(row.requesterPersonId) ?? null;
  }

  const dto = toDto(row!, personName);
  await writeAuditLog({
    userId,
    action: "task_created",
    entityType: "task",
    entityId: dto.id,
    metadata: {
      title: dto.title,
      aiGenerated: input.aiGenerated ?? false,
      sourceCaptureId: input.sourceCaptureId ?? null,
      requesterPersonId: dto.requesterPersonId,
      requesterPersonName: dto.requesterPersonName,
    },
  });
  const personBits = [dto.requesterPersonName, dto.requesterPersonId]
    .filter(Boolean)
    .join(" ");
  warmEntityEmbedding(userId, {
    entityType: "task",
    entityId: dto.id,
    text: `${dto.title} priority=${dto.priority} due=${dto.time ?? "none"} completed=${dto.completed}${
      personBits ? ` person=${personBits}` : ""
    }`,
  });
  await syncPrimaryPersonLink(userId, "task", dto.id, dto.requesterPersonId);
  return dto;
}

export async function bulkUpsertTasksForUser(
  userId: string,
  items: CreateTaskInput[],
): Promise<RecallTaskDto[]> {
  const results: RecallTaskDto[] = [];
  for (const item of items) {
    const id = item.id?.trim() || newTaskId();
    const existing = await getDb()
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
      .limit(1);

    if (existing[0]) {
      const updated = await updateTaskForUser(userId, id, {
        title: item.title,
        time: item.time,
        priority: item.priority,
        tags: item.tags,
        completed: item.completed,
        projectId: item.projectId,
        requesterPersonId: item.requesterPersonId,
      });
      if (updated) results.push(updated);
    } else {
      const created = await createTaskForUser(userId, { ...item, id });
      results.push(created);
    }
  }
  return results;
}

export async function updateTaskForUser(
  userId: string,
  taskId: string,
  input: UpdateTaskInput,
): Promise<RecallTaskDto | null> {
  const db = getDb();
  const existing = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);

  if (!existing[0]) return null;

  const wasCompleted = existing[0].completed;

  // When the linked person changes, keep person: tags aligned unless the
  // caller already sent an explicit tags array.
  let tagsToWrite = input.tags;
  if (input.requesterPersonId !== undefined && input.tags === undefined) {
    const base = [...(existing[0].tags ?? [])].filter((t) => !/^person:/i.test(t));
    if (input.requesterPersonId) {
      const names = await personNamesById(userId, [input.requesterPersonId]);
      const name = names.get(input.requesterPersonId);
      tagsToWrite = name ? [...base, `person:${name}`] : base;
    } else {
      tagsToWrite = base;
    }
  }

  const [row] = await db
    .update(tasks)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.time !== undefined ? { time: input.time } : {}),
      ...(input.priority !== undefined
        ? { priority: normalizePriority(input.priority) }
        : {}),
      ...(tagsToWrite !== undefined ? { tags: tagsToWrite } : {}),
      ...(input.completed !== undefined ? { completed: input.completed } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.requesterPersonId !== undefined
        ? { requesterPersonId: input.requesterPersonId }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .returning();

  if (!row) return null;

  let personName: string | null = null;
  if (row.requesterPersonId) {
    const names = await personNamesById(userId, [row.requesterPersonId]);
    personName = names.get(row.requesterPersonId) ?? null;
  }
  const dto = toDto(row, personName);

  if (input.completed !== undefined && input.completed !== wasCompleted) {
    await writeAuditLog({
      userId,
      action: input.completed ? "task_completed" : "task_reopened",
      entityType: "task",
      entityId: dto.id,
      metadata: { title: dto.title },
    });
  }

  if (
    input.title !== undefined ||
    input.time !== undefined ||
    input.priority !== undefined ||
    input.tags !== undefined ||
    input.requesterPersonId !== undefined ||
    input.completed !== undefined
  ) {
    const personBits = [dto.requesterPersonName, dto.requesterPersonId]
      .filter(Boolean)
      .join(" ");
    warmEntityEmbedding(userId, {
      entityType: "task",
      entityId: dto.id,
      text: `${dto.title} priority=${dto.priority} due=${dto.time ?? "none"} completed=${dto.completed}${
        personBits ? ` person=${personBits}` : ""
      }`,
    });
  }

  if (input.requesterPersonId !== undefined) {
    await syncPrimaryPersonLink(userId, "task", dto.id, dto.requesterPersonId);
  }

  return dto;
}

export async function deleteTaskForUser(
  userId: string,
  taskId: string,
): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .returning({ id: tasks.id });
  return deleted.length > 0;
}
