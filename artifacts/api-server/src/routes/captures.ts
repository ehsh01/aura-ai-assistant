import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import {
  CaptureStatusTransitionError,
  getCaptureForUser,
  listCapturesForUser,
  updateCaptureStatusForUser,
} from "../services/captures";
import {
  ingestCaptureForUser,
  retryCaptureExtraction,
} from "../services/capture-pipeline";
import {
  CreateCaptureBody,
  ListCapturesQuery,
  UpdateCaptureStatusBody,
} from "../validation/captures";

/**
 * Capture Layer API (docs/08_API_Standards.md §5).
 *
 * These routes intake and expose RAW captures. They never run AI inline —
 * capture is stored first and interpreted later by background extraction.
 */
const router: IRouter = Router();

router.use(requireAuth);

router.post("/captures", async (req, res, next) => {
  try {
    const body = CreateCaptureBody.parse(req.body);
    const { capture, jobId } = await ingestCaptureForUser(req.user!.id, {
      rawText: body.rawText,
      sourceType: body.sourceType,
      sourceName: body.sourceName ?? null,
      sourceUrl: body.sourceUrl ?? null,
      title: body.title ?? null,
      rawHtml: body.rawHtml ?? null,
      rawMetadata: body.rawMetadata,
      capturedAt: body.capturedAt,
    });
    res.status(201).json({ ...capture, jobId });
  } catch (err) {
    next(err);
  }
});

router.get("/captures", async (req, res, next) => {
  try {
    const query = ListCapturesQuery.parse(req.query);
    const items = await listCapturesForUser(req.user!.id, {
      status: query.status,
      limit: query.limit,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get("/captures/:captureId", async (req, res, next) => {
  try {
    const capture = await getCaptureForUser(req.user!.id, req.params.captureId);
    if (!capture) {
      res.status(404).json({ error: "NOT_FOUND", message: "Capture not found" });
      return;
    }
    res.json(capture);
  } catch (err) {
    next(err);
  }
});

router.patch("/captures/:captureId", async (req, res, next) => {
  try {
    const body = UpdateCaptureStatusBody.parse(req.body);
    const capture = await updateCaptureStatusForUser(req.user!.id, req.params.captureId, {
      processedStatus: body.processedStatus,
      processingError: body.processingError,
      title: body.title,
    });
    if (!capture) {
      res.status(404).json({ error: "NOT_FOUND", message: "Capture not found" });
      return;
    }
    res.json(capture);
  } catch (err) {
    if (err instanceof CaptureStatusTransitionError) {
      res.status(409).json({ error: "CONFLICT", message: err.message });
      return;
    }
    next(err);
  }
});

router.post("/captures/:captureId/retry-extraction", async (req, res, next) => {
  try {
    const capture = await getCaptureForUser(req.user!.id, req.params.captureId);
    if (!capture) {
      res.status(404).json({ error: "NOT_FOUND", message: "Capture not found" });
      return;
    }
    const { jobId } = await retryCaptureExtraction(req.user!.id, req.params.captureId);
    res.status(202).json({ jobId, status: "queued" });
  } catch (err) {
    next(err);
  }
});

export default router;
