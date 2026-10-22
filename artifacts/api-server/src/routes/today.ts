import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { buildTodayForUser } from "../services/today";
import { buildTodayDashboardForUser } from "../services/today-dashboard";
import {
  getCachedHomeBriefing,
  getEveningCheckinForUser,
} from "../services/home-briefing";
import { getWeeklyDigestForUser } from "../services/weekly-digest";

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

router.get("/today/dashboard", async (req, res, next) => {
  try {
    const data = await buildTodayDashboardForUser(req.user!.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get("/home", async (req, res, next) => {
  try {
    const data = await getCachedHomeBriefing(req.user!.id, req.user!.name);
    // The service has a per-user 60s cache. Keep personalized data out of the
    // browser HTTP cache so account switching cannot reuse another user's Home.
    res.set("Cache-Control", "private, no-store");
    res.vary("Cookie");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get("/digest/weekly", async (req, res, next) => {
  try {
    const digest = await getWeeklyDigestForUser(req.user!.id);
    res.json(digest);
  } catch (err) {
    next(err);
  }
});

router.get("/checkin", async (req, res, next) => {
  try {
    const data = await getEveningCheckinForUser(req.user!.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
