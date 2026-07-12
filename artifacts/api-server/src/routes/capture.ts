import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  AcceptCaptureBody,
  CreateCaptureBody,
  ListCaptureInboxResponse,
  UpdateCaptureBody,
} from "@workspace/api-zod";
import { LIFE_MEMORY_DOMAINS } from "@workspace/db/schema";
import { requireAuth } from "../middleware/auth";
import {
  acceptCaptureForUser,
  createCaptureForUser as createInboxItemForUser,
  listCaptureInboxForUser,
  updateCaptureForUser,
} from "../services/capture-items";
import {
  createCaptureForUser as createRawCaptureForUser,
  updateCaptureStatusForUser,
} from "../services/captures";
import { aiService } from "../services/ai";
import { writeAuditLog } from "../services/audit";

const AcceptBody = AcceptCaptureBody.extend({
  saveAsMemory: z.boolean().optional(),
  memoryDomain: z.enum(LIFE_MEMORY_DOMAINS).nullish(),
});

const router: IRouter = Router();

router.use(requireAuth);

router.post("/capture", async (req, res, next) => {
  let rawCaptureId: string | null = null;
  try {
    const body = CreateCaptureBody.parse(req.body);
    const rawCapture = await createRawCaptureForUser(req.user!.id, {
      rawText: body.rawText,
      sourceType: "manual",
      sourceName: "legacy_capture_api",
      rawMetadata: {
        mode: body.mode,
        dueDate: body.dueDate ?? null,
        projectId: body.projectId ?? null,
        notebookId: body.notebookId ?? null,
        tags: body.tags ?? [],
      },
    });
    rawCaptureId = rawCapture.id;
    await updateCaptureStatusForUser(req.user!.id, rawCapture.id, {
      processedStatus: "processing",
    });
    await writeAuditLog({
      userId: req.user!.id,
      action: "capture_created",
      entityType: "capture",
      entityId: rawCapture.id,
      metadata: { sourceType: "manual", compatibilityPath: true },
    });

    const classification = await aiService.classifyCapture({
      rawText: body.rawText,
      dueDate: body.dueDate ?? null,
      tags: body.tags ?? [],
    });
    const item = await createInboxItemForUser(req.user!.id, {
      ...body,
      rawCaptureId: rawCapture.id,
      classification: classification.degraded ? undefined : classification.item,
    });
    await updateCaptureStatusForUser(req.user!.id, rawCapture.id, {
      processedStatus: "processed",
    });
    await writeAuditLog({
      userId: req.user!.id,
      action: "capture_extracted",
      entityType: "capture",
      entityId: rawCapture.id,
      metadata: { inboxId: item.id, compatibilityPath: true },
    });
    res.setHeader("Deprecation", "true");
    res.setHeader("Sunset", "Wed, 31 Dec 2026 23:59:59 GMT");
    res.setHeader("Link", '</api/captures>; rel="successor-version"');
    res.status(201).json(item);
  } catch (err) {
    if (rawCaptureId) {
      try {
        await updateCaptureStatusForUser(req.user!.id, rawCaptureId, {
          processedStatus: "failed",
          processingError: err instanceof Error ? err.message.slice(0, 1000) : "Capture failed",
        });
      } catch {
        // Preserve the original error; raw capture remains available for manual retry.
      }
    }
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
    const body = AcceptBody.parse(req.body ?? {});
    const result = await acceptCaptureForUser(req.user!.id, req.params.captureId, body);
    if (!result) {
      res.status(404).json({ error: "NOT_FOUND", message: "Capture item not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
