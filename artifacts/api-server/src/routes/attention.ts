import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  attentionUrgencyScore,
  completeAttention,
  dismissAttention,
  getAttentionForUser,
  listAttentionForToday,
  markAttentionSeen,
  snoozeAttention,
  type SnoozePreset,
} from "../services/attention";
import { enqueueJob, JOB_TYPE_ATTENTION_SCAN } from "../services/job-queue";
import { nudgeJobWorker } from "../services/job-worker";

const router: IRouter = Router();
router.use(requireAuth);

const snoozeSchema = z.object({
  until: z.string().datetime().optional().nullable(),
  preset: z
    .enum(["7d_before", "1d_before", "morning_of", "1d", "3d", "7d"])
    .optional()
    .nullable(),
});

router.get("/attention", async (req, res, next) => {
  try {
    const items = await listAttentionForToday(req.user!.id);
    const now = new Date();
    items.sort((a, b) => attentionUrgencyScore(b, now) - attentionUrgencyScore(a, now));
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

/** Manual trigger: promote calendar + scan recent Gmail for deadlines. */
router.post("/attention/scan", async (req, res, next) => {
  try {
    const job = await enqueueJob({
      userId: req.user!.id,
      type: JOB_TYPE_ATTENTION_SCAN,
      payload: {},
      id: `attn-scan-${req.user!.id}-${Date.now()}`,
    });
    nudgeJobWorker();
    res.status(202).json({ jobId: job.id, status: job.status });
  } catch (err) {
    next(err);
  }
});

router.get("/attention/:id", async (req, res, next) => {
  try {
    const item = await getAttentionForUser(req.user!.id, req.params.id);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Attention item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post("/attention/:id/seen", async (req, res, next) => {
  try {
    const item = await markAttentionSeen(req.user!.id, req.params.id);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Attention item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post("/attention/:id/dismiss", async (req, res, next) => {
  try {
    const item = await dismissAttention(req.user!.id, req.params.id);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Attention item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post("/attention/:id/complete", async (req, res, next) => {
  try {
    const item = await completeAttention(req.user!.id, req.params.id);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Attention item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post("/attention/:id/snooze", async (req, res, next) => {
  try {
    const body = snoozeSchema.parse(req.body ?? {});
    const item = await snoozeAttention(req.user!.id, req.params.id, {
      until: body.until,
      preset: (body.preset ?? null) as SnoozePreset | null,
    });
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Attention item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

export default router;
