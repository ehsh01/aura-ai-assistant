import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth";
import { config } from "../lib/config";
import { getKnowledgeGraphForUser, parseGraphQuery } from "../services/item-graph";
import {
  getItemForUser,
  getItemMediaForUser,
  listItemFacetsForUser,
  listItemsForUser,
  parseItemSearchFilters,
  saveFileItemForUser,
  saveTextItemForUser,
} from "../services/items";

const router: IRouter = Router();
const itemImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.attachmentMaxBytes, files: 1 },
});

router.use(requireAuth);

function uploadImage(req: Request, res: Response, next: NextFunction): void {
  itemImageUpload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "FILE_TOO_LARGE", message: "Image exceeds the upload size cap" });
      return;
    }
    if (error) {
      next(error);
      return;
    }
    next();
  });
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
      res.status(400).json({ error: "NO_FILE", message: "Choose an image to save" });
      return;
    }
    const item = await saveFileItemForUser(req.user!.id, req.file);
    res.status(201).json({ item, existing: false });
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
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${found.fileName.replace(/"/g, "")}"`,
    );
    res.sendFile(found.path);
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
