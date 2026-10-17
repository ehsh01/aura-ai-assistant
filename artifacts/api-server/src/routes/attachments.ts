import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { getAttachmentForUser, listAttachmentsForNote } from "../services/note-attachments";
import { AttachmentAiOcrError, extractAttachmentTextWithAi } from "../services/attachment-ai-ocr";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/notes/:noteId/attachments", async (req, res, next) => {
  try {
    const attachments = await listAttachmentsForNote(req.user!.id, req.params.noteId);
    res.json({ attachments });
  } catch (err) {
    next(err);
  }
});

router.get("/attachments/:attachmentId", async (req, res, next) => {
  try {
    const found = await getAttachmentForUser(req.user!.id, req.params.attachmentId);
    if (!found) {
      res.status(404).json({ error: "NOT_FOUND", message: "Attachment not found" });
      return;
    }

    res.setHeader("Content-Type", found.row.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${found.row.fileName.replace(/"/g, "")}"`);
    res.sendFile(found.absPath);
  } catch (err) {
    next(err);
  }
});

router.post("/attachments/:attachmentId/extract-text-ai", async (req, res, next) => {
  try {
    const result = await extractAttachmentTextWithAi(req.user!.id, req.params.attachmentId);
    res.json(result);
  } catch (err) {
    if (err instanceof AttachmentAiOcrError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    next(err);
  }
});

export default router;
