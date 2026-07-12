import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  createExtensionTokenForUser,
  listExtensionTokensForUser,
  revokeExtensionTokenForUser,
} from "../services/extension-tokens";
import { writeAuditLog } from "../services/audit";

const CreateExtensionTokenBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

const router: IRouter = Router();
router.use(requireAuth);

router.get("/extension-tokens", async (req, res, next) => {
  try {
    const items = await listExtensionTokensForUser(req.user!.id);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post("/extension-tokens", async (req, res, next) => {
  try {
    const body = CreateExtensionTokenBody.parse(req.body ?? {});
    const created = await createExtensionTokenForUser(req.user!.id, body);
    await writeAuditLog({
      userId: req.user!.id,
      action: "extension_token_created",
      entityType: "extension_token",
      entityId: created.item.id,
      metadata: {
        scope: created.item.scope,
        expiresAt: created.item.expiresAt,
      },
    });
    // The raw token is returned exactly once and is never persisted.
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.delete("/extension-tokens/:tokenId", async (req, res, next) => {
  try {
    const revoked = await revokeExtensionTokenForUser(req.user!.id, req.params.tokenId);
    if (!revoked) {
      res.status(404).json({ error: "NOT_FOUND", message: "Extension token not found" });
      return;
    }
    await writeAuditLog({
      userId: req.user!.id,
      action: "extension_token_revoked",
      entityType: "extension_token",
      entityId: req.params.tokenId,
      metadata: {},
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
