import { and, desc, eq, sql } from "drizzle-orm";
import { notebooks, notes, type Notebook } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { noteDateLabel } from "../lib/recall-format";

export type RecallNotebookDto = {
  id: string;
  name: string;
  source: string;
  noteCount: number;
  date: string;
};

function toDto(row: Notebook, noteCount: number): RecallNotebookDto {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    noteCount,
    date: noteDateLabel(row.updatedAt),
  };
}

function stableNotebookId(userId: string, name: string): string {
  const raw = `${userId}\0${name.toLowerCase()}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  }
  return `notebook-en-${Math.abs(h).toString(36)}`;
}

export function notebookNameFromFileName(fileName?: string): string {
  if (!fileName?.trim()) return "Imported Notebook";
  const base = fileName.replace(/\.(enex|xml)$/i, "").trim();
  return base || "Imported Notebook";
}

export async function listNotebooksForUser(userId: string): Promise<RecallNotebookDto[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: notebooks.id,
      userId: notebooks.userId,
      name: notebooks.name,
      source: notebooks.source,
      createdAt: notebooks.createdAt,
      updatedAt: notebooks.updatedAt,
      noteCount: sql<number>`cast(count(${notes.id}) as int)`,
    })
    .from(notebooks)
    .leftJoin(notes, and(eq(notes.notebookId, notebooks.id), eq(notes.userId, userId)))
    .where(eq(notebooks.userId, userId))
    .groupBy(notebooks.id)
    .orderBy(desc(notebooks.updatedAt));

  return rows.map((row) =>
    toDto(
      {
        id: row.id,
        userId: row.userId,
        name: row.name,
        source: row.source,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      row.noteCount ?? 0,
    ),
  );
}

export async function findOrCreateEvernoteNotebook(
  userId: string,
  fileName?: string,
): Promise<RecallNotebookDto> {
  const db = getDb();
  const name = notebookNameFromFileName(fileName);
  const id = stableNotebookId(userId, name);
  const now = new Date();

  const existing = await db
    .select()
    .from(notebooks)
    .where(and(eq(notebooks.id, id), eq(notebooks.userId, userId)))
    .limit(1);

  if (existing[0]) {
    const [updated] = await db
      .update(notebooks)
      .set({ updatedAt: now })
      .where(and(eq(notebooks.id, id), eq(notebooks.userId, userId)))
      .returning();

    const countRows = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(notes)
      .where(and(eq(notes.notebookId, id), eq(notes.userId, userId)));

    return toDto(updated ?? existing[0], countRows[0]?.count ?? 0);
  }

  const [created] = await db
    .insert(notebooks)
    .values({
      id,
      userId,
      name,
      source: "evernote",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return toDto(created!, 0);
}

export async function refreshNotebookNoteCount(
  userId: string,
  notebookId: string,
): Promise<number> {
  const countRows = await getDb()
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(notes)
    .where(and(eq(notes.notebookId, notebookId), eq(notes.userId, userId)));

  return countRows[0]?.count ?? 0;
}

export async function getNotebookForUser(
  userId: string,
  notebookId: string,
): Promise<RecallNotebookDto | null> {
  const db = getDb();
  const existing = await db
    .select()
    .from(notebooks)
    .where(and(eq(notebooks.id, notebookId), eq(notebooks.userId, userId)))
    .limit(1);

  if (!existing[0]) return null;

  const noteCount = await refreshNotebookNoteCount(userId, notebookId);
  return toDto(existing[0], noteCount);
}
