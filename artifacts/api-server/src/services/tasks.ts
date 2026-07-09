import { and, desc, eq } from "drizzle-orm";
import { tasks, type Task } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newTaskId } from "../lib/recall-format";
import { writeAuditLog } from "./audit";

export type RecallTaskDto = {
  id: string;
  title: string;
  time?: string;
  priority: "high" | "med" | "low" | "none";
  tags?: string[];
  completed: boolean;
  projectId: string | null;
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
};

function normalizePriority(
  priority?: string,
): "high" | "med" | "low" | "none" {
  if (priority === "high") return "high";
  if (priority === "med" || priority === "medium") return "med";
  if (priority === "low") return "low";
  return "none";
}

function toDto(row: Task): RecallTaskDto {
  return {
    id: row.id,
    title: row.title,
    time: row.time ?? undefined,
    priority: normalizePriority(row.priority),
    tags: row.tags ?? [],
    completed: row.completed,
    projectId: row.projectId ?? null,
  };
}

export async function listTasksForUser(userId: string): Promise<RecallTaskDto[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .orderBy(desc(tasks.updatedAt));
  return rows.map(toDto);
}

export async function createTaskForUser(
  userId: string,
  input: CreateTaskInput,
): Promise<RecallTaskDto> {
  const db = getDb();
  const now = new Date();
  const id = input.id?.trim() || newTaskId();

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
      tags: input.tags ?? [],
      completed: input.completed ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const dto = toDto(row!);
  await writeAuditLog({
    userId,
    action: "task_created",
    entityType: "task",
    entityId: dto.id,
    metadata: {
      title: dto.title,
      aiGenerated: input.aiGenerated ?? false,
      sourceCaptureId: input.sourceCaptureId ?? null,
    },
  });
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
  const [row] = await db
    .update(tasks)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.time !== undefined ? { time: input.time } : {}),
      ...(input.priority !== undefined
        ? { priority: normalizePriority(input.priority) }
        : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.completed !== undefined ? { completed: input.completed } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .returning();

  if (!row) return null;
  const dto = toDto(row);

  if (input.completed !== undefined && input.completed !== wasCompleted) {
    await writeAuditLog({
      userId,
      action: input.completed ? "task_completed" : "task_reopened",
      entityType: "task",
      entityId: dto.id,
      metadata: { title: dto.title },
    });
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
