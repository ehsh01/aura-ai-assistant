import { Router, type IRouter } from "express";
import { z } from "zod";
import { LIFE_MEMORY_DOMAINS } from "@workspace/db/schema";
import { requireAuth } from "../middleware/auth";
import {
  classifyMemoryText,
  createMemoryForUser,
  deleteMemoryForUser,
  exportMemoriesMarkdownForUser,
  getMemoryForUser,
  listMemoriesForUser,
  updateMemoryForUser,
} from "../services/life-memory";

const DomainSchema = z.enum(LIFE_MEMORY_DOMAINS);

const CreateBody = z.object({
  title: z.string().max(500).optional(),
  content: z.string().min(1).max(50_000),
  domain: DomainSchema.nullish(),
  tags: z.array(z.string()).optional(),
  primaryPersonId: z.string().nullish(),
  projectId: z.string().nullish(),
  sourceType: z.enum(["teach", "capture", "ask", "import"]).optional(),
  sourceId: z.string().nullish(),
  pinned: z.boolean().optional(),
});

const UpdateBody = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().min(1).max(50_000).optional(),
  domain: DomainSchema.nullish(),
  tags: z.array(z.string()).optional(),
  primaryPersonId: z.string().nullish(),
  projectId: z.string().nullish(),
  pinned: z.boolean().optional(),
});

const ClassifyBody = z.object({
  content: z.string().min(1).max(50_000),
});

const router: IRouter = Router();
router.use(requireAuth);

router.get("/memory", async (req, res, next) => {
  try {
    const domain = typeof req.query.domain === "string" ? req.query.domain : undefined;
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const items = await listMemoriesForUser(req.user!.id, { domain, q });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get("/memory/export.md", async (req, res, next) => {
  try {
    const md = await exportMemoriesMarkdownForUser(req.user!.id);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Recall-Life-Memory.md"',
    );
    res.send(md);
  } catch (err) {
    next(err);
  }
});

router.post("/memory/classify", async (req, res, next) => {
  try {
    const body = ClassifyBody.parse(req.body);
    const result = await classifyMemoryText(body.content);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/memory", async (req, res, next) => {
  try {
    const body = CreateBody.parse(req.body);
    const item = await createMemoryForUser(req.user!.id, body);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.get("/memory/:memoryId", async (req, res, next) => {
  try {
    const item = await getMemoryForUser(req.user!.id, req.params.memoryId);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Memory not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.patch("/memory/:memoryId", async (req, res, next) => {
  try {
    const body = UpdateBody.parse(req.body);
    const item = await updateMemoryForUser(req.user!.id, req.params.memoryId, body);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Memory not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.delete("/memory/:memoryId", async (req, res, next) => {
  try {
    const ok = await deleteMemoryForUser(req.user!.id, req.params.memoryId);
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Memory not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
