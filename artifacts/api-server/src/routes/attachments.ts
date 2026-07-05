import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import {
  getAttachmentForUser,
  listAttachmentsForNote,
} from "../services/note-attachments";

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
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${found.row.fileName.replace(/"/g, "")}"`,
    );
    res.sendFile(found.absPath);
  } catch (err) {
    next(err);
  }
});

export default router;
