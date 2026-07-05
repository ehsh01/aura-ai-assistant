import { mkdir, rm, stat, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { RecallNoteDto } from "./notes";
import {
  bulkImportEnexNotesForUser,
  type CreateNoteInput,
} from "./notes";
import { parseEnexFileStream } from "./enex-import";
import {
  findOrCreateEvernoteNotebook,
  getNotebookForUser,
  type RecallNotebookDto,
} from "./notebooks";
import { config } from "../lib/config";
import { logger } from "../lib/logger";

export type EnexFileImportResult = {
  parsed: number;
  imported: number;
  updated: number;
  skipped: number;
  notebook: RecallNotebookDto;
  notes: RecallNoteDto[];
  errors: string[];
};

const RESPONSE_NOTE_LIMIT = 40;

function safeUploadPath(userId: string, uploadId: string): string {
  const safeId = uploadId.replace(/[^a-zA-Z0-9-]/g, "");
  if (!safeId || safeId !== uploadId) {
    throw new Error("Invalid upload id");
  }
  return path.join(config.uploadDir, userId, `${safeId}.enex`);
}

export async function ensureUserUploadDir(userId: string): Promise<string> {
  const dir = path.join(config.uploadDir, userId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function appendUploadChunk(
  userId: string,
  uploadId: string,
  chunkIndex: number,
  totalChunks: number,
  data: Buffer,
): Promise<string> {
  if (totalChunks < 1 || chunkIndex < 0 || chunkIndex >= totalChunks) {
    throw new Error("Invalid chunk index");
  }

  await ensureUserUploadDir(userId);
  const dest = safeUploadPath(userId, uploadId);

  if (chunkIndex === 0) {
    await writeFile(dest, data);
  } else {
    await appendFile(dest, data);
  }

  const info = await stat(dest);
  if (info.size > config.uploadMaxBytes) {
    await rm(dest, { force: true });
    throw new Error(
      `File exceeds maximum upload size (${Math.round(config.uploadMaxBytes / (1024 * 1024 * 1024))}GB)`,
    );
  }

  return dest;
}

export async function importEnexFileForUser(
  userId: string,
  filePath: string,
  fileName: string,
): Promise<EnexFileImportResult> {
  const notebook = await findOrCreateEvernoteNotebook(userId, fileName);

  let imported = 0;
  let skipped = 0;
  let updated = 0;
  const errors: string[] = [];
  const responseNotes: RecallNoteDto[] = [];

  logger.info(
    { userId, fileName, filePath },
    "Evernote ENEX file import started",
  );

  const { parsed, errors: parseErrors } = await parseEnexFileStream(
    filePath,
    fileName,
    { userId },
    async (batch: CreateNoteInput[]) => {
      const withNotebook = batch.map((n) => ({
        ...n,
        notebookId: notebook.id,
      }));

      const { inserted, updated: batchUpdated } = await bulkImportEnexNotesForUser(
        userId,
        withNotebook,
      );
      imported += inserted.length;
      updated += batchUpdated;
      skipped += withNotebook.length - inserted.length - batchUpdated;

      for (const n of inserted) {
        if (responseNotes.length < RESPONSE_NOTE_LIMIT) {
          responseNotes.push(n);
        }
      }

      logger.info(
        { userId, fileName, imported, updated, skipped, parsedSoFar: imported + updated + skipped },
        "Evernote ENEX import progress",
      );
    },
    5,
  );

  errors.push(...parseErrors);

  const updatedNotebook =
    (await getNotebookForUser(userId, notebook.id)) ?? notebook;

  logger.info(
    { userId, fileName, parsed, imported, updated, skipped },
    "Evernote ENEX file import finished",
  );

  if (parsed === 0) {
    throw new Error(errors[0] ?? "No notes found in Evernote export");
  }

  return {
    parsed,
    imported,
    updated,
    skipped,
    notebook: updatedNotebook,
    notes: responseNotes,
    errors,
  };
}

export async function cleanupUploadFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}
