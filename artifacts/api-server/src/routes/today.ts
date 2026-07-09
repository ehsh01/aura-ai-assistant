import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { buildTodayForUser } from "../services/today";
import { buildHomeBriefing } from "../services/home-briefing";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/today", async (req, res, next) => {
  try {
    const data = await buildTodayForUser(req.user!.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get("/home", async (req, res, next) => {
  try {
    const data = await buildHomeBriefing(req.user!.id, req.user!.name);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
