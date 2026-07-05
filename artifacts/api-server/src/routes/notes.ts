import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { mkdir } from "node:fs/promises";
import multer from "multer";
import {
  BulkUpsertNotesBody,
  CreateNoteBody,
  ListNotesResponse,
  UpdateNoteBody,
  UpdateNoteResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { config } from "../lib/config";
import { enexChunkUpload, enexFileUpload } from "../lib/upload";
import {
  bulkUpsertNotesForUser,
  createNoteForUser,
  deleteNoteForUser,
  getNoteForUser,
  listNoteMetadataForUser,
  listNotesForUser,
  updateNoteForUser,
} from "../services/notes";
import { parseEnexXml } from "../services/enex-import";
import {
  appendUploadChunk,
  cleanupUploadFile,
  ensureUserUploadDir,
  importEnexFileForUser,
} from "../services/enex-import-runner";
import {
  ensureImportJob,
  startImportJob,
} from "../services/enex-import-jobs";
import {
  findOrCreateEvernoteNotebook,
  getNotebookForUser,
} from "../services/notebooks";
import {
  ImportEnexNotesBody,
  ImportEnexNotesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.use(requireAuth);

void mkdir(config.uploadDir, { recursive: true });
void mkdir(config.attachmentsDir, { recursive: true });

function handleMulterError(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: `File exceeds the maximum upload size (${Math.round(config.uploadMaxBytes / (1024 * 1024 * 1024))}GB)`,
      });
      return;
    }
    res.status(400).json({ error: "UPLOAD_ERROR", message: err.message });
    return;
  }
  next(err);
}

router.get("/notes", async (req, res, next) => {
  try {
    const notes = await listNoteMetadataForUser(req.user!.id);
    res.json(ListNotesResponse.parse({ notes }));
  } catch (err) {
    next(err);
  }
});

router.post("/notes", async (req, res, next) => {
  try {
    const body = CreateNoteBody.parse(req.body);
    const note = await createNoteForUser(req.user!.id, body);
    res.status(201).json(UpdateNoteResponse.parse(note));
  } catch (err) {
    next(err);
  }
});

router.post("/notes/bulk", async (req, res, next) => {
  try {
    const body = BulkUpsertNotesBody.parse(req.body);
    const notes = await bulkUpsertNotesForUser(req.user!.id, body.notes);
    res.json(ListNotesResponse.parse({ notes }));
  } catch (err) {
    next(err);
  }
});

router.post("/notes/import/enex", async (req, res, next) => {
  try {
    const body = ImportEnexNotesBody.parse(req.body);
    const { notes: parsed, errors } = parseEnexXml(body.xml, body.fileName);

    logger.info(
      {
        userId: req.user!.id,
        fileName: body.fileName,
        xmlBytes: body.xml.length,
        parsed: parsed.length,
      },
      "Evernote ENEX import",
    );

    if (parsed.length === 0) {
      res.status(400).json({
        error: "NO_NOTES",
        message: errors[0] ?? "No notes found in Evernote export",
        errors,
      });
      return;
    }

    const notebook = await findOrCreateEvernoteNotebook(req.user!.id, body.fileName);
    const parsedWithNotebook = parsed.map((n) => ({
      ...n,
      notebookId: notebook.id,
    }));

    const existing = await listNotesForUser(req.user!.id);
    const existingIds = new Set(existing.map((n) => n.id));
    const toSend = parsedWithNotebook.filter((n) => n.id && !existingIds.has(n.id));
    const skipped = parsed.length - toSend.length;

    const CHUNK = 40;
    const importedNotes = [];
    for (let i = 0; i < toSend.length; i += CHUNK) {
      const chunk = await bulkUpsertNotesForUser(
        req.user!.id,
        toSend.slice(i, i + CHUNK),
      );
      importedNotes.push(...chunk);
    }

    const updatedNotebook =
      (await getNotebookForUser(req.user!.id, notebook.id)) ?? notebook;

    res.json(
      ImportEnexNotesResponse.parse({
        parsed: parsed.length,
        imported: importedNotes.length,
        updated: 0,
        skipped,
        notebook: updatedNotebook,
        notes: importedNotes,
        errors,
      }),
    );
  } catch (err) {
    next(err);
  }
});

/** Single-file uploads at or below this size import inline (no background job). */
const SYNC_ENEX_IMPORT_MAX_BYTES = 15 * 1024 * 1024;

router.get("/notes/import/enex/status/:jobId", async (req, res, next) => {
  try {
    const job = await ensureImportJob(req.params.jobId, req.user!.id);
    if (!job) {
      res.status(404).json({ error: "NOT_FOUND", message: "Import job not found" });
      return;
    }

    if (job.status === "processing") {
      res.json({ jobId: req.params.jobId, status: "processing" });
      return;
    }

    if (job.status === "failed") {
      res.status(400).json({
        jobId: req.params.jobId,
        status: "failed",
        message: job.error ?? "Import failed",
      });
      return;
    }

    res.json({
      jobId: req.params.jobId,
      status: "complete",
      ...ImportEnexNotesResponse.parse(job.result),
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/notes/import/enex-file",
  (req, res, next) => {
    enexFileUpload.single("file")(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  async (req, res, next) => {
    const uploaded = req.file;
    if (!uploaded) {
      res.status(400).json({ error: "NO_FILE", message: "Missing file field" });
      return;
    }

    try {
      await ensureUserUploadDir(req.user!.id);

      if (uploaded.size <= SYNC_ENEX_IMPORT_MAX_BYTES) {
        try {
          const result = await importEnexFileForUser(
            req.user!.id,
            uploaded.path,
            uploaded.originalname,
          );
          res.json(ImportEnexNotesResponse.parse(result));
        } catch (err) {
          const message = err instanceof Error ? err.message : "Import failed";
          res.status(400).json({ error: "IMPORT_FAILED", message, errors: [message] });
        } finally {
          await cleanupUploadFile(uploaded.path);
        }
        return;
      }

      const jobId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await startImportJob(
        req.user!.id,
        jobId,
        uploaded.path,
        uploaded.originalname,
      );
      res.status(202).json({
        jobId,
        status: "processing",
        message: "Import started — large files may take several minutes",
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/notes/import/enex/chunk",
  (req, res, next) => {
    enexChunkUpload.single("chunk")(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  async (req, res, next) => {
    try {
      const uploadId = String(req.body.uploadId ?? "");
      const chunkIndex = Number(req.body.chunkIndex);
      const totalChunks = Number(req.body.totalChunks);
      const fileName = String(req.body.fileName ?? "import.enex");
      const chunk = req.file;

      if (!chunk?.buffer?.length) {
        res.status(400).json({ error: "NO_CHUNK", message: "Missing chunk data" });
        return;
      }

      const dest = await appendUploadChunk(
        req.user!.id,
        uploadId,
        chunkIndex,
        totalChunks,
        chunk.buffer,
      );

      const isLast = chunkIndex === totalChunks - 1;
      if (!isLast) {
        res.json({
          ok: true,
          uploadId,
          received: chunkIndex + 1,
          total: totalChunks,
        });
        return;
      }

      logger.info(
        {
          userId: req.user!.id,
          fileName,
          uploadId,
          totalChunks,
        },
        "Evernote ENEX chunked upload complete — importing",
      );

      await startImportJob(req.user!.id, uploadId, dest, fileName);
      res.status(202).json({
        jobId: uploadId,
        status: "processing",
        message: "Upload complete — importing notes in the background",
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/notes/:noteId", async (req, res, next) => {
  try {
    const note = await getNoteForUser(req.user!.id, req.params.noteId);
    if (!note) {
      res.status(404).json({ error: "NOT_FOUND", message: "Note not found" });
      return;
    }
    res.json(UpdateNoteResponse.parse(note));
  } catch (err) {
    next(err);
  }
});

router.patch("/notes/:noteId", async (req, res, next) => {
  try {
    const body = UpdateNoteBody.parse(req.body);
    const note = await updateNoteForUser(
      req.user!.id,
      req.params.noteId,
      body,
    );
    if (!note) {
      res.status(404).json({ error: "NOT_FOUND", message: "Note not found" });
      return;
    }
    res.json(UpdateNoteResponse.parse(note));
  } catch (err) {
    next(err);
  }
});

router.delete("/notes/:noteId", async (req, res, next) => {
  try {
    const ok = await deleteNoteForUser(req.user!.id, req.params.noteId);
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Note not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
