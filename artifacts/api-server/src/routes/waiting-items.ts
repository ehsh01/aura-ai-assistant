import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  completeWaitingItem,
  confirmWaitingCandidate,
  dismissWaitingItem,
  getWaitingItemForUser,
  listWaitingAuditForItem,
  listWaitingDueForUser,
  listWaitingItemsForUser,
  patchWaitingItemForUser,
  reopenWaitingItem,
  snoozeWaitingItem,
  upsertWaitingItemForUser,
  type WaitingItemPatch,
} from "../services/waiting-items";
import { extractWaitingForSource } from "../services/waiting-extract";
import {
  draftWaitingFollowUpForItem,
  markWaitingFollowUpSent,
} from "../services/waiting-follow-up";
import { listEvidenceForEntity } from "../services/evidence";
import { enqueueJob, JOB_TYPE_WAITING_SCAN } from "../services/job-queue";
import { nudgeJobWorker } from "../services/job-worker";
import { dueAtFromDateString, type SnoozePreset } from "../services/attention";

const router: IRouter = Router();
router.use(requireAuth);

const snoozeSchema = z.object({
  until: z.string().datetime().optional().nullable(),
  preset: z
    .enum(["7d_before", "1d_before", "morning_of", "1d", "3d", "7d"])
    .optional()
    .nullable(),
});

const createSchema = z.object({
  ownerName: z.string().min(1).max(200),
  ownerOrg: z.string().max(200).optional().nullable(),
  deliverable: z.string().min(1).max(2000),
  promisedAt: z.string().optional().nullable(),
  expectedAt: z.string().optional().nullable(),
  dateConfidence: z.enum(["certain", "uncertain", "none"]).optional(),
  followUpAt: z.string().optional().nullable(),
  threadId: z.string().max(128).optional().nullable(),
  sourceEntityType: z.string().max(32).optional(),
  sourceEntityId: z.string().max(64).optional(),
  evidenceText: z.string().max(4000).optional().nullable(),
});

const patchSchema = z.object({
  ownerName: z.string().max(200).optional().nullable(),
  ownerOrg: z.string().max(200).optional().nullable(),
  ownerPersonId: z.string().max(64).optional().nullable(),
  deliverable: z.string().max(2000).optional().nullable(),
  promisedAt: z.string().optional().nullable(),
  expectedAt: z.string().optional().nullable(),
  dateConfidence: z.enum(["certain", "uncertain", "none"]).optional().nullable(),
  followUpAt: z.string().optional().nullable(),
  threadId: z.string().max(128).optional().nullable(),
  projectId: z.string().max(64).optional().nullable(),
  taskId: z.string().max(64).optional().nullable(),
});

const extractSchema = z.object({
  sourceRecordId: z.string().min(1),
});

router.get("/waiting-items", async (req, res, next) => {
  try {
    const statusRaw = typeof req.query.status === "string" ? req.query.status : "active";
    const due = req.query.due === "true" || req.query.due === "1";
    if (due) {
      const items = await listWaitingDueForUser(req.user!.id);
      res.json({ items });
      return;
    }
    const status = ["candidate", "open", "snoozed", "completed", "dismissed", "active", "all"].includes(
      statusRaw,
    )
      ? (statusRaw as "candidate" | "open" | "snoozed" | "completed" | "dismissed" | "active" | "all")
      : "active";
    const items = await listWaitingItemsForUser(req.user!.id, { status });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

/** Manual trigger: scan recent Gmail for commitments + reply outcomes. */
router.post("/waiting-items/scan", async (req, res, next) => {
  try {
    const job = await enqueueJob({
      userId: req.user!.id,
      type: JOB_TYPE_WAITING_SCAN,
      payload: {},
      id: `wait-scan-${req.user!.id}-${Date.now()}`,
    });
    nudgeJobWorker();
    res.status(202).json({ jobId: job.id, status: job.status });
  } catch (err) {
    next(err);
  }
});

/** Track a specific synced source record (manual extraction, low threshold). */
router.post("/waiting-items/extract", async (req, res, next) => {
  try {
    const body = extractSchema.parse(req.body ?? {});
    const result = await extractWaitingForSource(req.user!.id, body.sourceRecordId);
    if (!result) {
      res.status(404).json({ error: "NOT_FOUND", message: "Source record not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/waiting-items", async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body ?? {});
    const { item, created } = await upsertWaitingItemForUser(req.user!.id, {
      ownerName: body.ownerName,
      ownerOrg: body.ownerOrg ?? null,
      deliverable: body.deliverable,
      promisedAt: body.promisedAt ? dueAtFromDateString(body.promisedAt) : null,
      expectedAt: body.expectedAt ? dueAtFromDateString(body.expectedAt) : null,
      dateConfidence: body.dateConfidence,
      followUpAt: body.followUpAt ? dueAtFromDateString(body.followUpAt) : null,
      threadId: body.threadId ?? null,
      sourceEntityType: body.sourceEntityType ?? "manual",
      sourceEntityId: body.sourceEntityId ?? `manual-${Date.now()}`,
      evidenceText: body.evidenceText ?? null,
      metadata: { createdVia: "manual" },
    });
    res.status(created ? 201 : 200).json(item);
  } catch (err) {
    next(err);
  }
});

router.get("/waiting-items/:id", async (req, res, next) => {
  try {
    const item = await getWaitingItemForUser(req.user!.id, req.params.id);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Waiting item not found" });
      return;
    }
    const [evidenceRows, audit] = await Promise.all([
      listEvidenceForEntity(req.user!.id, "waiting_item", item.id),
      listWaitingAuditForItem(req.user!.id, item.id),
    ]);
    res.json({ item, evidence: evidenceRows, audit });
  } catch (err) {
    next(err);
  }
});

router.patch("/waiting-items/:id", async (req, res, next) => {
  try {
    const body = patchSchema.parse(req.body ?? {});
    const item = await patchWaitingItemForUser(
      req.user!.id,
      req.params.id,
      body as WaitingItemPatch,
    );
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Waiting item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post("/waiting-items/:id/snooze", async (req, res, next) => {
  try {
    const body = snoozeSchema.parse(req.body ?? {});
    const item = await snoozeWaitingItem(req.user!.id, req.params.id, {
      until: body.until,
      preset: (body.preset ?? null) as SnoozePreset | null,
    });
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Waiting item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

/** Confirm a review-queue candidate so it becomes a tracked commitment. */
router.post("/waiting-items/:id/confirm", async (req, res, next) => {
  try {
    const item = await confirmWaitingCandidate(req.user!.id, req.params.id);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Waiting item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post("/waiting-items/:id/dismiss", async (req, res, next) => {
  try {
    const item = await dismissWaitingItem(req.user!.id, req.params.id);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Waiting item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post("/waiting-items/:id/reopen", async (req, res, next) => {
  try {
    const item = await reopenWaitingItem(req.user!.id, req.params.id);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Waiting item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post("/waiting-items/:id/complete", async (req, res, next) => {
  try {
    const item = await completeWaitingItem(req.user!.id, req.params.id);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Waiting item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post("/waiting-items/:id/follow-up-draft", async (req, res, next) => {
  try {
    const result = await draftWaitingFollowUpForItem(req.user!.id, req.params.id);
    if (!result) {
      res.status(404).json({ error: "NOT_FOUND", message: "Waiting item not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const sentSchema = z.object({ days: z.number().int().min(1).max(30).optional() });

router.post("/waiting-items/:id/follow-up", async (req, res, next) => {
  try {
    const body = sentSchema.parse(req.body ?? {});
    const item = await markWaitingFollowUpSent(req.user!.id, req.params.id, {
      days: body.days,
    });
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Waiting item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

export default router;
