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
  getGmailAttachmentForUser,
  getRecallDocumentForUser,
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

export function isSafeInlineMediaType(mimeType: string): boolean {
  const mime = mimeType.toLowerCase().split(";", 1)[0]!.trim();
  return (
    mime === "application/pdf" ||
    mime === "text/plain" ||
    /^image\/(?:avif|bmp|gif|jpe?g|png|webp)$/.test(mime)
  );
}

function setOwnerDocumentHeaders(
  mimeType: string,
  fileName: string,
  download: boolean,
  res: Response,
): void {
  const inline = !download && isSafeInlineMediaType(mimeType);
  const disposition = inline ? "inline" : "attachment";
  res.setHeader(
    "Content-Type",
    inline || download ? mimeType : "application/octet-stream",
  );
  res.setHeader("Content-Disposition", `${disposition}; filename="${fileName}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
  );
}

function streamOwnerDocument(found: OwnerDocumentResponse, req: Request, res: Response): void {
  setOwnerDocumentHeaders(
    found.mimeType,
    found.fileName,
    req.query.download === "1",
    res,
  );
  if (found.path) {
    res.sendFile(found.path);
    return;
  }
  if (!found.response?.body) {
    res.status(502).json({
      error: "EMPTY_DOCUMENT",
      message: "Document returned no content",
    });
    return;
  }
  const stream = Readable.fromWeb(
    found.response.body as import("node:stream/web").ReadableStream,
  );
  stream.once("error", () => {
    if (res.headersSent) res.destroy();
    else res.status(502).end();
  });
  res.once("close", () => stream.destroy());
  stream.pipe(res);
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

router.get(
  "/items/source-records/:sourceRecordId/gmail-attachments/:attachmentId/media",
  async (req, res, next) => {
    try {
      const found = await getGmailAttachmentForUser(
        req.user!.id,
        req.params.sourceRecordId,
        req.params.attachmentId,
      );
      if (!found) {
        res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Attachment not found" });
        return;
      }
      streamOwnerDocument(found, req, res);
    } catch (error) {
      next(error);
    }
  },
);

router.get("/items/documents/:documentId/media", async (req, res, next) => {
  try {
    const found = await getRecallDocumentForUser(
      req.user!.id,
      req.params.documentId,
    );
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
    setOwnerDocumentHeaders(
      found.mimeType,
      found.fileName.replace(/"/g, ""),
      req.query.download === "1",
      res,
    );
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
