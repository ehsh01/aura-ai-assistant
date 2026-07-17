import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  createDocumentForUser,
  getDocumentForUser,
  listDocumentsForUser,
} from "../services/documents";
import {
  confirmReceiptMatch,
  suggestReceiptMatchesForDocument,
  unlinkReceiptMatch,
} from "../services/receipt-match";
import {
  createKnowledgeForUser,
  getKnowledgeForUser,
  listKnowledgeForUser,
  updateKnowledgeForUser,
} from "../services/knowledge";

const CreateDocumentBody = z.object({
  fileName: z.string().min(1).max(500),
  fileType: z.string().max(64).nullish(),
  storagePath: z.string().nullish(),
  sourceCaptureId: z.string().nullish(),
  extractedText: z.string().nullish(),
  summary: z.string().nullish(),
  metadata: z.record(z.unknown()).optional(),
});

const CreateKnowledgeBody = z.object({
  title: z.string().min(1).max(500),
  content: z.string().optional(),
  itemType: z.string().max(32).optional(),
  tags: z.array(z.string()).optional(),
  projectId: z.string().nullish(),
  primaryPersonId: z.string().nullish(),
  sourceCaptureId: z.string().nullish(),
});

const UpdateKnowledgeBody = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().optional(),
  itemType: z.string().max(32).optional(),
  tags: z.array(z.string()).optional(),
  projectId: z.string().nullish(),
  primaryPersonId: z.string().nullish(),
});

const router: IRouter = Router();
router.use(requireAuth);

router.get("/documents", async (req, res, next) => {
  try {
    const documents = await listDocumentsForUser(req.user!.id);
    res.json({ documents });
  } catch (err) {
    next(err);
  }
});

router.post("/documents", async (req, res, next) => {
  try {
    const body = CreateDocumentBody.parse(req.body);
    const doc = await createDocumentForUser(req.user!.id, body);
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
});

router.get("/documents/:documentId", async (req, res, next) => {
  try {
    const doc = await getDocumentForUser(req.user!.id, req.params.documentId);
    if (!doc) {
      res.status(404).json({ error: "NOT_FOUND", message: "Document not found" });
      return;
    }
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

router.get("/documents/:documentId/receipt-matches", async (req, res, next) => {
  try {
    const result = await suggestReceiptMatchesForDocument(
      req.user!.id,
      req.params.documentId,
    );
    if (!result) {
      res.status(404).json({ error: "NOT_FOUND", message: "Document not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/documents/:documentId/receipt-matches/confirm", async (req, res, next) => {
  try {
    const body = z.object({ sourceRecordId: z.string().min(1).max(64) }).parse(req.body);
    const result = await confirmReceiptMatch(
      req.user!.id,
      req.params.documentId,
      body.sourceRecordId,
    );
    if (!result.ok) {
      res.status(404).json({ error: "NOT_FOUND", message: result.error });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/documents/:documentId/receipt-matches/unlink", async (req, res, next) => {
  try {
    const body = z.object({ sourceRecordId: z.string().min(1).max(64) }).parse(req.body);
    const ok = await unlinkReceiptMatch(
      req.user!.id,
      req.params.documentId,
      body.sourceRecordId,
    );
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Link not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/knowledge", async (req, res, next) => {
  try {
    const items = await listKnowledgeForUser(req.user!.id);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post("/knowledge", async (req, res, next) => {
  try {
    const body = CreateKnowledgeBody.parse(req.body);
    const item = await createKnowledgeForUser(req.user!.id, body);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.get("/knowledge/:itemId", async (req, res, next) => {
  try {
    const item = await getKnowledgeForUser(req.user!.id, req.params.itemId);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Knowledge item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.patch("/knowledge/:itemId", async (req, res, next) => {
  try {
    const body = UpdateKnowledgeBody.parse(req.body);
    const item = await updateKnowledgeForUser(req.user!.id, req.params.itemId, body);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Knowledge item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

export default router;
