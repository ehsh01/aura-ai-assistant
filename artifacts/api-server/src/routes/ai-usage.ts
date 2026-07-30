import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { usageSummary } from "../services/ai-usage";

const router: IRouter = Router();
router.use(requireAuth);

/**
 * Spend breakdown by feature and model. Metadata only — no prompt content —
 * so this is safe to surface in the app.
 */
router.get("/ai/usage", async (req, res, next) => {
  try {
    const raw = Number(req.query.days ?? "30");
    const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, raw)) : 30;
    res.json(await usageSummary(days));
  } catch (err) {
    next(err);
  }
});

export default router;
