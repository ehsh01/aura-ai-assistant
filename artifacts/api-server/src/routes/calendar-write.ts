import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { createCalendarEventForUser } from "../services/connectors";

const router: IRouter = Router();
router.use(requireAuth);

const Body = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(4000).nullable().optional(),
  start: z.string().min(8).max(64),
  end: z.string().max(64).nullable().optional(),
});

router.post("/calendar/events", async (req, res, next) => {
  try {
    const body = Body.parse(req.body ?? {});
    const created = await createCalendarEventForUser(req.user!.id, {
      title: body.title,
      description: body.description ?? null,
      start: body.start,
      end: body.end ?? null,
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

export default router;
