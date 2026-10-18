import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { Readable } from "node:stream";
import { requireAuth } from "../middleware/auth";
import { config } from "../lib/config";
import { getKnowledgeGraphForUser, parseGraphQuery } from "../services/item-graph";
import {
  deleteItemForUser,
  getItemForUser,
  getItemMediaForUser,
  listItemFacetsForUser,
  listItemsForUser,
  parseItemSearchFilters,
  saveFileItemForUser,
  saveTextItemForUser,
} from "../services/items";
import { searchExploreForUser } from "../services/explore-search";
import {
  getEvernoteAttachmentForUser,
  getSourceRecordDocumentForUser,
  type OwnerDocumentResponse,
} from "../services/item-documents";

const router: IRouter = Router();
const itemImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.attachmentMaxBytes, files: 1 },
});

router.use(requireAuth);

function uploadImage(req: Request, res: Response, next: NextFunction): void {
  itemImageUpload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: "File exceeds the upload size cap",
      });
      return;
    }
    if (error) {
      next(error);
      return;
    }
    next();
  });
}

function streamOwnerDocument(found: OwnerDocumentResponse, req: Request, res: Response): void {
  const disposition = req.query.download === "1" ? "attachment" : "inline";
  res.setHeader("Content-Type", found.mimeType);
  res.setHeader("Content-Disposition", `${disposition}; filename="${found.fileName}"`);
  res.setHeader("Cache-Control", "private, no-store");
  if (!found.response.body) {
    res.status(502).json({
      error: "EMPTY_DOCUMENT",
      message: "Document returned no content",
    });
    return;
  }
  Readable.fromWeb(found.response.body as import("node:stream/web").ReadableStream).pipe(res);
}

router.get("/items", async (req, res, next) => {
  try {
    const filters = parseItemSearchFilters(req.query as Record<string, unknown>);
    const itemRows = await listItemsForUser(req.user!.id, filters);
    res.json({ items: itemRows, filters });
  } catch (error) {
    next(error);
  }
});

router.get("/items/facets", async (req, res, next) => {
  try {
    res.json(await listItemFacetsForUser(req.user!.id));
  } catch (error) {
    next(error);
  }
});

router.get("/items/search", async (req, res, next) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const limit = Number(req.query.limit);
    const results = await searchExploreForUser(req.user!.id, query, Number.isFinite(limit) ? limit : 20);
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

router.get("/items/graph", async (req, res, next) => {
  try {
    const query = parseGraphQuery(req.query as Record<string, unknown>);
    res.json(await getKnowledgeGraphForUser(req.user!.id, query));
  } catch (error) {
    next(error);
  }
});

router.post("/items", async (req, res, next) => {
  try {
    const value = typeof req.body?.value === "string" ? req.body.value : "";
    const item = await saveTextItemForUser(req.user!.id, value);
    res.status(item.existing ? 200 : 201).json({ item, existing: Boolean(item.existing) });
  } catch (error) {
    next(error);
  }
});

router.post("/items/image", uploadImage, async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "NO_FILE", message: "Choose a file to save" });
      return;
    }
    const caption = typeof req.body?.caption === "string" ? req.body.caption : "";
    const item = await saveFileItemForUser(req.user!.id, req.file, caption);
    res.status(201).json({ item, existing: false });
  } catch (error) {
    next(error);
  }
});

router.post("/items/file", uploadImage, async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "NO_FILE", message: "Choose a file to save" });
      return;
    }
    const caption = typeof req.body?.caption === "string" ? req.body.caption : "";
    const item = await saveFileItemForUser(req.user!.id, req.file, caption);
    res.status(201).json({ item, existing: false });
  } catch (error) {
    next(error);
  }
});

router.get("/items/evernote-attachments/:attachmentId/media", async (req, res, next) => {
  try {
    const found = await getEvernoteAttachmentForUser(req.user!.id, req.params.attachmentId);
    if (!found) {
      res.status(404).json({ error: "NOT_FOUND", message: "Attachment not found" });
      return;
    }
    streamOwnerDocument(found, req, res);
  } catch (error) {
    next(error);
  }
});

router.get("/items/source-records/:sourceRecordId/media", async (req, res, next) => {
  try {
    const found = await getSourceRecordDocumentForUser(req.user!.id, req.params.sourceRecordId);
    if (!found) {
      res.status(404).json({ error: "NOT_FOUND", message: "Document not found" });
      return;
    }
    streamOwnerDocument(found, req, res);
  } catch (error) {
    next(error);
  }
});

router.get("/items/:itemId/media", async (req, res, next) => {
  try {
    const found = await getItemMediaForUser(req.user!.id, req.params.itemId);
    if (!found) {
      res.status(404).json({ error: "NOT_FOUND", message: "Item media not found" });
      return;
    }
    res.setHeader("Content-Type", found.mimeType);
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.setHeader("Content-Disposition", `${disposition}; filename="${found.fileName.replace(/"/g, "")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(found.path);
  } catch (error) {
    next(error);
  }
});

router.delete("/items/:itemId", async (req, res, next) => {
  try {
    const deleted = await deleteItemForUser(req.user!.id, req.params.itemId);
    if (!deleted) {
      res.status(404).json({ error: "NOT_FOUND", message: "Item not found" });
      return;
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/items/:itemId", async (req, res, next) => {
  try {
    const item = await getItemForUser(req.user!.id, req.params.itemId);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Item not found" });
      return;
    }
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

export default router;
