import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { noteAttachments, notes, type Note } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import {
  newNoteId,
  noteDateLabel,
  previewFromContent,
} from "../lib/recall-format";
import {
  registerNoteAttachments,
  type PendingNoteAttachment,
} from "./note-attachments";
import { attachmentSearchTextForNotes } from "./attachment-text-extract";
import { writeAuditLog } from "./audit";
import { warmEntityEmbedding } from "./embedding-cache";
import {
  personNamesById,
  resolvePersonIdFromTags,
  syncPersonTag,
} from "./person-tags";

export type RecallNoteDto = {
  id: string;
  title: string;
  content: string;
  preview: string;
  contentFormat: "plain" | "html";
  tags: string[];
  date: string;
  pinned: boolean;
  notebookId: string | null;
  projectId: string | null;
  primaryPersonId: string | null;
  primaryPersonName: string | null;
  attachmentCount: number;
  /** Capped searchable text from attached images/PDFs/docs. */
  attachmentText?: string;
  createdAt: string;
  updatedAt: string;
};

export type RecallNoteMetadataDto = Omit<RecallNoteDto, "content">;

export type CreateNoteInput = {
  id?: string;
  title?: string;
  content?: string;
  contentFormat?: "plain" | "html";
  tags?: string[];
  pinned?: boolean;
  notebookId?: string | null;
  projectId?: string | null;
  primaryPersonId?: string | null;
  pendingAttachments?: PendingNoteAttachment[];
};

export type UpdateNoteInput = {
  title?: string;
  content?: string;
  contentFormat?: "plain" | "html";
  tags?: string[];
  pinned?: boolean;
  notebookId?: string | null;
  projectId?: string | null;
  primaryPersonId?: string | null;
};

function toDto(
  row: Note,
  attachmentCount = 0,
  personName: string | null = null,
  attachmentText = "",
): RecallNoteDto {
  const format = row.contentFormat === "html" ? "html" : "plain";
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    preview: row.preview,
    contentFormat: format,
    tags: row.tags ?? [],
    date: noteDateLabel(row.updatedAt),
    pinned: row.pinned,
    notebookId: row.notebookId ?? null,
    projectId: row.projectId ?? null,
    primaryPersonId: row.primaryPersonId ?? null,
    primaryPersonName: personName,
    attachmentCount,
    ...(attachmentText ? { attachmentText } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMetadata(dto: RecallNoteDto): RecallNoteMetadataDto {
  const { content: _content, ...meta } = dto;
  return meta;
}

async function attachmentCountsForNotes(noteIds: string[]): Promise<Map<string, number>> {
  if (noteIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      noteId: noteAttachments.noteId,
      count: sql<number>`cast(count(${noteAttachments.id}) as int)`,
    })
    .from(noteAttachments)
    .where(inArray(noteAttachments.noteId, noteIds))
    .groupBy(noteAttachments.noteId);
  return new Map(rows.map((row) => [row.noteId, row.count ?? 0]));
}

export async function listNotesForUser(userId: string): Promise<RecallNoteDto[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(notes)
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt));
  const noteIds = rows.map((row) => row.id);
  const counts = await attachmentCountsForNotes(noteIds);
  const attachmentTexts = await attachmentSearchTextForNotes(noteIds);
  const names = await personNamesById(
    userId,
    rows.map((r) => r.primaryPersonId).filter((id): id is string => Boolean(id)),
  );
  return rows.map((row) =>
    toDto(
      row,
      counts.get(row.id) ?? 0,
      row.primaryPersonId ? names.get(row.primaryPersonId) ?? null : null,
      attachmentTexts.get(row.id) ?? "",
    ),
  );
}

export async function listNoteMetadataForUser(userId: string): Promise<RecallNoteMetadataDto[]> {
  const all = await listNotesForUser(userId);
  return all.map(toMetadata);
}

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "my",
  "me",
  "i",
  "you",
  "find",
  "show",
  "get",
  "where",
  "what",
  "how",
  "is",
  "are",
  "do",
  "does",
  "can",
  "please",
  "note",
  "notes",
  "for",
  "of",
  "in",
  "on",
  "to",
  "and",
  "or",
]);

function extractSearchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/['']/g, "")
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2 && !SEARCH_STOP_WORDS.has(term));
}

/** Keyword search across the user's full note library (title, preview, tags, attachment text). */
export async function searchNotesForUser(
  userId: string,
  query: string,
  limit = 20,
): Promise<RecallNoteMetadataDto[]> {
  const terms = extractSearchTerms(query);
  if (terms.length === 0) return [];

  const db = getDb();
  const termFilters = terms.map((term) => {
    const pattern = `%${term}%`;
    return or(
      ilike(notes.title, pattern),
      ilike(notes.preview, pattern),
      ilike(notes.content, pattern),
      sql`${notes.tags}::text ilike ${pattern}`,
      sql`exists (
        select 1 from note_attachments na
        where na.note_id = ${notes.id}
          and (
            na.file_name ilike ${pattern}
            or coalesce(na.extracted_text, '') ilike ${pattern}
          )
      )`,
    );
  });

  const rows = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), ...termFilters))
    .orderBy(desc(notes.updatedAt))
    .limit(limit);

  const noteIds = rows.map((row) => row.id);
  const counts = await attachmentCountsForNotes(noteIds);
  const attachmentTexts = await attachmentSearchTextForNotes(noteIds);
  const names = await personNamesById(
    userId,
    rows.map((r) => r.primaryPersonId).filter((id): id is string => Boolean(id)),
  );
  return rows.map((row) =>
    toMetadata(
      toDto(
        row,
        counts.get(row.id) ?? 0,
        row.primaryPersonId ? names.get(row.primaryPersonId) ?? null : null,
        attachmentTexts.get(row.id) ?? "",
      ),
    ),
  );
}

export async function getNoteForUser(
  userId: string,
  noteId: string,
): Promise<RecallNoteDto | null> {
  const row = await getDb()
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .limit(1);
  if (!row[0]) return null;
  const counts = await attachmentCountsForNotes([noteId]);
  const attachmentTexts = await attachmentSearchTextForNotes([noteId]);
  let personName: string | null = null;
  if (row[0].primaryPersonId) {
    const names = await personNamesById(userId, [row[0].primaryPersonId]);
    personName = names.get(row[0].primaryPersonId) ?? null;
  }
  return toDto(
    row[0],
    counts.get(noteId) ?? 0,
    personName,
    attachmentTexts.get(noteId) ?? "",
  );
}

export async function createNoteForUser(
  userId: string,
  input: CreateNoteInput,
): Promise<RecallNoteDto> {
  const db = getDb();
  const content = input.content ?? "";
  const contentFormat = input.contentFormat ?? "plain";
  const now = new Date();
  const id = input.id?.trim() || newNoteId();

  let tags = [...(input.tags ?? [])];
  let primaryPersonId: string | null;
  if (input.primaryPersonId === null) {
    primaryPersonId = null;
    tags = syncPersonTag(tags, null);
  } else if (input.primaryPersonId) {
    primaryPersonId = input.primaryPersonId;
  } else {
    primaryPersonId = await resolvePersonIdFromTags(userId, tags);
  }
  let personName: string | null = null;
  if (primaryPersonId) {
    const names = await personNamesById(userId, [primaryPersonId]);
    personName = names.get(primaryPersonId) ?? null;
    if (personName) tags = syncPersonTag(tags, personName);
  }

  const [row] = await db
    .insert(notes)
    .values({
      id,
      userId,
      notebookId: input.notebookId ?? null,
      projectId: input.projectId ?? null,
      primaryPersonId,
      title: input.title?.trim() || "Untitled",
      content,
      contentFormat,
      preview: previewFromContent(
        contentFormat === "html" ? content.replace(/<[^>]+>/g, " ") : content,
      ),
      tags,
      pinned: input.pinned ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const dto = toDto(row!, 0, personName);
  await writeAuditLog({
    userId,
    action: "note_created",
    entityType: "note",
    entityId: dto.id,
    metadata: {
      title: dto.title,
      primaryPersonId: dto.primaryPersonId,
      primaryPersonName: dto.primaryPersonName,
    },
  });
  warmEntityEmbedding(userId, {
    entityType: "note",
    entityId: dto.id,
    text: `${dto.title}\n${dto.preview}\ntags=${dto.tags.join(",")}${
      personName ? ` person=${personName}` : ""
    }`,
  });
  return dto;
}

export async function listNoteIdsForUser(userId: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ id: notes.id })
    .from(notes)
    .where(eq(notes.userId, userId));
  return new Set(rows.map((row) => row.id));
}

export async function bulkInsertNotesForUser(
  userId: string,
  items: CreateNoteInput[],
): Promise<RecallNoteDto[]> {
  if (items.length === 0) return [];

  const now = new Date();
  const db = getDb();
  const values = items.map((item) => {
    const content = item.content ?? "";
    const contentFormat = item.contentFormat ?? "plain";
    return {
      id: item.id!.trim(),
      userId,
      notebookId: item.notebookId ?? null,
      projectId: item.projectId ?? null,
      title: item.title?.trim() || "Untitled",
      content,
      contentFormat,
      preview: previewFromContent(
        contentFormat === "html" ? content.replace(/<[^>]+>/g, " ") : content,
      ),
      tags: item.tags ?? [],
      pinned: item.pinned ?? false,
      createdAt: now,
      updatedAt: now,
    };
  });

  const inserted = await db.insert(notes).values(values).onConflictDoNothing().returning();
  return inserted.map((row) => toDto(row, 0));
}

async function registerPendingAttachments(
  userId: string,
  items: CreateNoteInput[],
): Promise<void> {
  const pending = items.flatMap((item) => item.pendingAttachments ?? []);
  if (pending.length === 0) return;
  await registerNoteAttachments(userId, pending);
}

/** Insert new notes; update existing Evernote imports with richer HTML + attachments. */
export async function bulkImportEnexNotesForUser(
  userId: string,
  items: CreateNoteInput[],
): Promise<{ inserted: RecallNoteDto[]; updated: number }> {
  if (items.length === 0) return { inserted: [], updated: 0 };

  const ids = items.map((i) => i.id!.trim());
  const existingRows = await getDb()
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.userId, userId), inArray(notes.id, ids)));
  const existingSet = new Set(existingRows.map((r) => r.id));

  const toInsert = items.filter((i) => !existingSet.has(i.id!.trim()));
  const toUpdate = items.filter((i) => existingSet.has(i.id!.trim()));

  const inserted = await bulkInsertNotesForUser(userId, toInsert);
  await registerPendingAttachments(userId, toInsert);

  let updated = 0;
  for (const item of toUpdate) {
    const id = item.id!.trim();
    const content = item.content ?? "";
    const contentFormat = item.contentFormat ?? "plain";
    const row = await updateNoteForUser(userId, id, {
      title: item.title,
      content,
      contentFormat,
      tags: item.tags,
      notebookId: item.notebookId,
      projectId: item.projectId,
    });
    if (row) updated++;
  }
  await registerPendingAttachments(userId, toUpdate);

  return { inserted, updated };
}

export async function bulkUpsertNotesForUser(
  userId: string,
  items: CreateNoteInput[],
): Promise<RecallNoteDto[]> {
  const results: RecallNoteDto[] = [];
  for (const item of items) {
    const id = item.id?.trim() || newNoteId();
    const content = item.content ?? "";
    const existing = await getDb()
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, userId)))
      .limit(1);

    if (existing[0]) {
      const updated = await updateNoteForUser(userId, id, {
        title: item.title,
        content: item.content,
        tags: item.tags,
        pinned: item.pinned,
        contentFormat: item.contentFormat,
        projectId: item.projectId,
        notebookId: item.notebookId,
        primaryPersonId: item.primaryPersonId,
      });
      if (updated) results.push(updated);
    } else {
      const created = await createNoteForUser(userId, { ...item, id });
      results.push(created);
    }
  }
  return results;
}

export async function updateNoteForUser(
  userId: string,
  noteId: string,
  input: UpdateNoteInput,
): Promise<RecallNoteDto | null> {
  const db = getDb();
  const existing = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .limit(1);

  if (!existing[0]) return null;

  let tagsToWrite = input.tags;
  let primaryPersonIdToWrite = input.primaryPersonId;

  if (input.primaryPersonId !== undefined) {
    const base = [...(input.tags ?? existing[0].tags ?? [])].filter(
      (t) => !/^person:/i.test(t),
    );
    if (input.primaryPersonId) {
      const names = await personNamesById(userId, [input.primaryPersonId]);
      const name = names.get(input.primaryPersonId);
      tagsToWrite = name ? [...base, `person:${name}`] : base;
    } else {
      tagsToWrite = base;
    }
  } else if (input.tags !== undefined) {
    primaryPersonIdToWrite = await resolvePersonIdFromTags(userId, input.tags);
  }

  const nextContent = input.content ?? existing[0].content;
  const nextFormat = input.contentFormat ?? existing[0].contentFormat ?? "plain";
  const [row] = await db
    .update(notes)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim() || "Untitled" } : {}),
      ...(input.content !== undefined ? { content: nextContent } : {}),
      ...(input.contentFormat !== undefined ? { contentFormat: nextFormat } : {}),
      ...(input.content !== undefined || input.contentFormat !== undefined
        ? {
            preview: previewFromContent(
              nextFormat === "html" ? nextContent.replace(/<[^>]+>/g, " ") : nextContent,
            ),
          }
        : {}),
      ...(tagsToWrite !== undefined ? { tags: tagsToWrite } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      ...(input.notebookId !== undefined ? { notebookId: input.notebookId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(primaryPersonIdToWrite !== undefined
        ? { primaryPersonId: primaryPersonIdToWrite }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .returning();

  if (!row) return null;
  const counts = await attachmentCountsForNotes([row.id]);
  let personName: string | null = null;
  if (row.primaryPersonId) {
    const names = await personNamesById(userId, [row.primaryPersonId]);
    personName = names.get(row.primaryPersonId) ?? null;
  }
  const dto = toDto(row, counts.get(row.id) ?? 0, personName);
  if (
    input.title !== undefined ||
    input.content !== undefined ||
    input.contentFormat !== undefined ||
    input.tags !== undefined ||
    input.primaryPersonId !== undefined
  ) {
    warmEntityEmbedding(userId, {
      entityType: "note",
      entityId: dto.id,
      text: `${dto.title}\n${dto.preview}\ntags=${dto.tags.join(",")}${
        personName ? ` person=${personName}` : ""
      }`,
    });
  }
  return dto;
}

export async function deleteNoteForUser(
  userId: string,
  noteId: string,
): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .returning({ id: notes.id });
  return deleted.length > 0;
}
