import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { noteAttachments } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { config } from "../lib/config";

export type NoteAttachmentDto = {
  id: string;
  noteId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
};

function extFromMime(mime: string, fileName?: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "video/mp4": "mp4",
    "text/plain": "txt",
    "text/html": "html",
  };
  if (map[mime]) return map[mime]!;
  const fromName = fileName?.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  const sub = mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "").slice(0, 8);
  return sub || "bin";
}

function attachmentIdFor(noteId: string, resourceHash: string): string {
  const hash = resourceHash.replace(/[^a-fA-F0-9]/g, "").toLowerCase().slice(0, 32) || "nohash";
  const noteKey = noteId.replace(/[^a-zA-Z0-9-]/g, "").slice(-24);
  return `att-${noteKey}-${hash}`;
}

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export type PendingNoteAttachment = {
  id: string;
  noteId: string;
  resourceHash: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
};

export async function writeAttachmentFile(opts: {
  userId: string;
  noteId: string;
  resourceHash: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
}): Promise<PendingNoteAttachment | null> {
  if (opts.data.length === 0) return null;
  if (opts.data.length > config.attachmentMaxBytes) return null;

  const id = attachmentIdFor(opts.noteId, opts.resourceHash || opts.fileName);
  const ext = extFromMime(opts.mimeType, opts.fileName);
  const relDir = path.join(opts.userId, opts.noteId);
  const absDir = path.join(config.attachmentsDir, relDir);
  await mkdir(absDir, { recursive: true });

  const storedName = `${id}.${ext}`;
  const absPath = path.join(absDir, storedName);
  const storagePath = path.join(relDir, storedName);

  await pipeline(Readable.from(opts.data), createWriteStream(absPath));

  return {
    id,
    noteId: opts.noteId,
    resourceHash: opts.resourceHash.toLowerCase(),
    fileName: opts.fileName,
    mimeType: opts.mimeType,
    sizeBytes: opts.data.length,
    storagePath,
  };
}

export async function registerNoteAttachments(
  userId: string,
  items: PendingNoteAttachment[],
): Promise<void> {
  if (items.length === 0) return;

  const db = getDb();
  for (const item of items) {
    await db
      .insert(noteAttachments)
      .values({
        id: item.id,
        userId,
        noteId: item.noteId,
        resourceHash: item.resourceHash,
        fileName: item.fileName,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        storagePath: item.storagePath,
      })
      .onConflictDoUpdate({
        target: noteAttachments.id,
        set: {
          fileName: item.fileName,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          storagePath: item.storagePath,
        },
      });
  }
}

export async function saveNoteAttachment(opts: {
  userId: string;
  noteId: string;
  resourceHash: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
}): Promise<NoteAttachmentDto | null> {
  const pending = await writeAttachmentFile(opts);
  if (!pending) return null;

  await registerNoteAttachments(opts.userId, [pending]);

  return {
    id: pending.id,
    noteId: pending.noteId,
    fileName: pending.fileName,
    mimeType: pending.mimeType,
    sizeBytes: pending.sizeBytes,
    isImage: isImageMime(pending.mimeType),
  };
}

export async function listAttachmentsForNote(
  userId: string,
  noteId: string,
): Promise<NoteAttachmentDto[]> {
  const rows = await getDb()
    .select()
    .from(noteAttachments)
    .where(and(eq(noteAttachments.userId, userId), eq(noteAttachments.noteId, noteId)));

  return rows.map((row) => ({
    id: row.id,
    noteId: row.noteId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    isImage: isImageMime(row.mimeType),
  }));
}

export async function getAttachmentForUser(
  userId: string,
  attachmentId: string,
): Promise<{ row: typeof noteAttachments.$inferSelect; absPath: string } | null> {
  const rows = await getDb()
    .select()
    .from(noteAttachments)
    .where(and(eq(noteAttachments.id, attachmentId), eq(noteAttachments.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const absPath = path.join(config.attachmentsDir, row.storagePath);
  try {
    await stat(absPath);
  } catch {
    return null;
  }

  return { row, absPath };
}
