import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  confirmLinkSuggestionForUser,
  dismissLinkSuggestionForUser,
  listLinkSuggestionsForUser,
} from "../services/link-suggestions";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/link-suggestions", async (req, res, next) => {
  try {
    const suggestions = await listLinkSuggestionsForUser(req.user!.id);
    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
});

const ConfirmBody = z.object({
  entityType: z.enum(["attention_item", "waiting_item", "task"]),
  entityId: z.string().min(1).max(64),
  field: z.enum(["personId", "ownerPersonId", "requesterPersonId", "projectId"]),
  value: z.string().min(1).max(64),
});

router.post("/link-suggestions/confirm", async (req, res, next) => {
  try {
    const body = ConfirmBody.parse(req.body);
    const ok = await confirmLinkSuggestionForUser(req.user!.id, body);
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Record or link target not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const DismissBody = z.object({
  id: z.string().min(1).max(256),
  entityType: z.string().min(1).max(64),
  entityId: z.string().min(1).max(64),
  suggestedName: z.string().min(1).max(255),
});

router.post("/link-suggestions/dismiss", async (req, res, next) => {
  try {
    const body = DismissBody.parse(req.body);
    await dismissLinkSuggestionForUser(req.user!.id, body);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
