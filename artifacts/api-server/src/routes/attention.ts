import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  attentionDueReason,
  attentionUrgencyScore,
  completeAttention,
  confirmAttentionItemForUser,
  dismissAttention,
  getAttentionForUser,
  listAttentionForToday,
  listDeadlinesForUser,
  markAttentionSeen,
  patchAttentionItemForUser,
  reopenAttentionItemForUser,
  listAttentionAuditForItem,
  snoozeAttention,
  validateAttentionPatch,
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

const patchSchema = z.object({
  title: z.string().max(500).optional().nullable(),
  summary: z.string().max(2000).optional().nullable(),
  dueAt: z.string().min(4).max(64).optional().nullable(),
  timeZone: z.string().max(64).optional().nullable(),
  timeKnown: z.boolean().optional().nullable(),
  dateConfidence: z.enum(["certain", "uncertain"]).optional().nullable(),
  kind: z.enum(["deadline", "appointment", "follow_up", "other"]).optional().nullable(),
  personId: z.string().max(64).optional().nullable(),
  projectId: z.string().max(64).optional().nullable(),
  taskId: z.string().max(64).optional().nullable(),
  organizationId: z.string().max(64).optional().nullable(),
  waitingItemId: z.string().max(64).optional().nullable(),
});

router.get("/attention", async (req, res, next) => {
  try {
    const items = await listAttentionForToday(req.user!.id);
    const now = new Date();
    items.sort((a, b) => attentionUrgencyScore(b, now) - attentionUrgencyScore(a, now));
    res.json({
      items: items.map((item) => ({
        ...item,
        dueReason: attentionDueReason(item, now),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** Grouped deadlines overview for the /deadlines view. */
router.get("/deadlines", async (req, res, next) => {
  try {
    const now = new Date();
    const overview = await listDeadlinesForUser(req.user!.id);
    const withReasons = (items: typeof overview.overdue) =>
      items.map((item) => ({ ...item, dueReason: attentionDueReason(item, now) }));
    res.json({
      overdue: withReasons(overview.overdue),
      today: withReasons(overview.today),
      thisWeek: withReasons(overview.thisWeek),
      later: withReasons(overview.later),
      unconfirmed: withReasons(overview.unconfirmed),
      snoozed: withReasons(overview.snoozed),
      recentTerminal: withReasons(overview.recentTerminal),
    });
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
    const audit = await listAttentionAuditForItem(req.user!.id, item.id);
    res.json({ ...item, dueReason: attentionDueReason(item), audit });
  } catch (err) {
    next(err);
  }
});

/** Correct any extracted field (editing the date confirms it). */
router.patch("/attention/:id", async (req, res, next) => {
  try {
    const body = patchSchema.parse(req.body ?? {});
    const validation = validateAttentionPatch(body);
    if (!validation.ok) {
      res.status(400).json({
        error: "VALIDATION",
        message: validation.errors.join("; "),
      });
      return;
    }
    const item = await patchAttentionItemForUser(req.user!.id, req.params.id, body);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Attention item not found" });
      return;
    }
    res.json({ ...item, dueReason: attentionDueReason(item) });
  } catch (err) {
    next(err);
  }
});

router.post("/attention/:id/confirm", async (req, res, next) => {
  try {
    const item = await confirmAttentionItemForUser(req.user!.id, req.params.id);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Attention item not found" });
      return;
    }
    res.json({ ...item, dueReason: attentionDueReason(item) });
  } catch (err) {
    next(err);
  }
});

router.post("/attention/:id/reopen", async (req, res, next) => {
  try {
    const item = await reopenAttentionItemForUser(req.user!.id, req.params.id);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Attention item not found" });
      return;
    }
    res.json({ ...item, dueReason: attentionDueReason(item) });
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
