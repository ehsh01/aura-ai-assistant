import { Router, type IRouter } from "express";
import {
  AcceptCaptureBody,
  AcceptCaptureResponse,
  CreateCaptureBody,
  ListCaptureInboxResponse,
  UpdateCaptureBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middleware/auth";
import {
  acceptCaptureForUser,
  createCaptureForUser,
  listCaptureInboxForUser,
  updateCaptureForUser,
} from "../services/capture-items";
import { aiService } from "../services/ai";

const router: IRouter = Router();

router.use(requireAuth);

router.post("/capture", async (req, res, next) => {
  try {
    const body = CreateCaptureBody.parse(req.body);
    const classification = await aiService.classifyCapture({
      rawText: body.rawText,
      dueDate: body.dueDate ?? null,
      tags: body.tags ?? [],
    });
    const item = await createCaptureForUser(req.user!.id, {
      ...body,
      classification: classification.degraded ? undefined : classification.item,
    });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.get("/capture/inbox", async (req, res, next) => {
  try {
    const items = await listCaptureInboxForUser(req.user!.id);
    res.json(ListCaptureInboxResponse.parse({ items }));
  } catch (err) {
    next(err);
  }
});

router.patch("/capture/:captureId", async (req, res, next) => {
  try {
    const body = UpdateCaptureBody.parse(req.body);
    const item = await updateCaptureForUser(req.user!.id, req.params.captureId, body);
    if (!item) {
      res.status(404).json({ error: "NOT_FOUND", message: "Capture item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post("/capture/:captureId/accept", async (req, res, next) => {
  try {
    const body = AcceptCaptureBody.parse(req.body ?? {});
    const result = await acceptCaptureForUser(req.user!.id, req.params.captureId, body);
    if (!result) {
      res.status(404).json({ error: "NOT_FOUND", message: "Capture item not found" });
      return;
    }
    res.json(AcceptCaptureResponse.parse(result));
  } catch (err) {
    next(err);
  }
});

export default router;
