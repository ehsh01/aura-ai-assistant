import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { usageSummary } from "../services/ai-usage";

const router: IRouter = Router();
router.use(requireAuth);

/**
 * Spend broken down per day and per feature/model. Metadata only — no prompt
 * content — so this is safe to surface in the app.
 *
 * Scoped to the caller. Only an admin can ask for install-wide totals, since
 * those would otherwise reveal how much other people use the app.
 */
router.get("/ai/usage", async (req, res, next) => {
  try {
    const raw = Number(req.query.days ?? "30");
    const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, raw)) : 30;
    const everyone = req.query.scope === "all" && req.user?.isAdmin === true;
    res.json(await usageSummary(days, everyone ? undefined : req.user!.id));
  } catch (err) {
    next(err);
  }
});

export default router;
