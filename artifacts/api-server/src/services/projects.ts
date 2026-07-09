import { and, desc, eq, sql } from "drizzle-orm";
import {
  captureItems,
  noteAttachments,
  notes,
  projects,
  tasks,
  type Project,
} from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newProjectId, noteDateLabel } from "../lib/recall-format";
import type { RecallCaptureItemDto } from "./capture-items";
import type { RecallNoteMetadataDto } from "./notes";
import type { RecallTaskDto } from "./tasks";

export type RecallProjectDto = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "paused" | "archived";
  relatedPeople: string[];
  noteCount: number;
  taskCount: number;
  captureCount: number;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDetailDto = {
  project: RecallProjectDto;
  notes: RecallNoteMetadataDto[];
  tasks: RecallTaskDto[];
  captures: RecallCaptureItemDto[];
};

export type CreateProjectInput = {
  id?: string;
  name: string;
  description?: string | null;
  status?: string;
  relatedPeople?: string[];
};

export type UpdateProjectInput = Partial<CreateProjectInput>;

function normalizeStatus(status?: string): "active" | "paused" | "archived" {
  if (status === "paused" || status === "archived") return status;
  return "active";
}

function baseDto(row: Project): Omit<RecallProjectDto, "noteCount" | "taskCount" | "captureCount" | "attachmentCount"> {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    status: normalizeStatus(row.status),
    relatedPeople: row.relatedPeople ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function projectCounts(userId: string, projectId: string) {
  const db = getDb();
  const [noteCount, taskCount, captureCount, attachmentCount] = await Promise.all([
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(notes)
      .where(and(eq(notes.userId, userId), eq(notes.projectId, projectId))),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.projectId, projectId))),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(captureItems)
      .where(and(eq(captureItems.userId, userId), eq(captureItems.projectId, projectId))),
    db
      .select({ count: sql<number>`cast(count(${noteAttachments.id}) as int)` })
      .from(noteAttachments)
      .innerJoin(notes, eq(notes.id, noteAttachments.noteId))
      .where(and(eq(notes.userId, userId), eq(notes.projectId, projectId))),
  ]);

  return {
    noteCount: noteCount[0]?.count ?? 0,
    taskCount: taskCount[0]?.count ?? 0,
    captureCount: captureCount[0]?.count ?? 0,
    attachmentCount: attachmentCount[0]?.count ?? 0,
  };
}

async function toDto(userId: string, row: Project): Promise<RecallProjectDto> {
  return {
    ...baseDto(row),
    ...(await projectCounts(userId, row.id)),
  };
}

export async function listProjectsForUser(userId: string): Promise<RecallProjectDto[]> {
  const rows = await getDb()
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt));
  return Promise.all(rows.map((row) => toDto(userId, row)));
}

export async function createProjectForUser(
  userId: string,
  input: CreateProjectInput,
): Promise<RecallProjectDto> {
  const now = new Date();
  const [row] = await getDb()
    .insert(projects)
    .values({
      id: input.id?.trim() || newProjectId(),
      userId,
      name: input.name.trim() || "Untitled Project",
      description: input.description ?? null,
      status: normalizeStatus(input.status),
      relatedPeople: input.relatedPeople ?? [],
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toDto(userId, row!);
}

export async function updateProjectForUser(
  userId: string,
  projectId: string,
  input: UpdateProjectInput,
): Promise<RecallProjectDto | null> {
  const [row] = await getDb()
    .update(projects)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() || "Untitled Project" } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.status !== undefined ? { status: normalizeStatus(input.status) } : {}),
      ...(input.relatedPeople !== undefined ? { relatedPeople: input.relatedPeople } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning();
  return row ? toDto(userId, row) : null;
}

export async function getProjectDetailForUser(
  userId: string,
  projectId: string,
): Promise<ProjectDetailDto | null> {
  const projectRows = await getDb()
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  const row = projectRows[0];
  if (!row) return null;

  const [noteRows, taskRows, captureRows] = await Promise.all([
    getDb()
      .select()
      .from(notes)
      .where(and(eq(notes.userId, userId), eq(notes.projectId, projectId)))
      .orderBy(desc(notes.updatedAt)),
    getDb()
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.projectId, projectId)))
      .orderBy(desc(tasks.updatedAt)),
    getDb()
      .select()
      .from(captureItems)
      .where(and(eq(captureItems.userId, userId), eq(captureItems.projectId, projectId)))
      .orderBy(desc(captureItems.updatedAt)),
  ]);

  return {
    project: await toDto(userId, row),
    notes: noteRows.map((note) => ({
      id: note.id,
      title: note.title,
      preview: note.preview,
      tags: note.tags ?? [],
      date: noteDateLabel(note.updatedAt),
      pinned: note.pinned,
      notebookId: note.notebookId ?? null,
      projectId: note.projectId ?? null,
      contentFormat: note.contentFormat === "html" ? "html" : "plain",
      attachmentCount: 0,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    })),
    tasks: taskRows.map((task) => ({
      id: task.id,
      title: task.title,
      time: task.time ?? undefined,
      priority: task.priority === "high" || task.priority === "med" || task.priority === "low" ? task.priority : "none",
      tags: task.tags ?? [],
      completed: task.completed,
      projectId: task.projectId ?? null,
    })),
    captures: captureRows.map((item) => ({
      id: item.id,
      rawCaptureId: item.rawCaptureId ?? null,
      rawText: item.rawText,
      cleanedTitle: item.cleanedTitle,
      suggestedType: item.suggestedType as RecallCaptureItemDto["suggestedType"],
      suggestedPriority: item.suggestedPriority as RecallCaptureItemDto["suggestedPriority"],
      suggestedDueDate: item.suggestedDueDate ?? null,
      suggestedProject: item.suggestedProject ?? null,
      suggestedTags: item.suggestedTags ?? [],
      suggestedActions: item.suggestedActions ?? [],
      suggestedPersonName: null,
      status: item.status as RecallCaptureItemDto["status"],
      projectId: item.projectId ?? null,
      notebookId: item.notebookId ?? null,
      attachmentCount: 0,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
  };
}
