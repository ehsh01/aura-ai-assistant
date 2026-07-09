import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { listAuditLogForUser } from "../services/audit";

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  action: z.string().max(64).optional(),
});

const router: IRouter = Router();
router.use(requireAuth);

router.get("/activity", async (req, res, next) => {
  try {
    const query = ListQuery.parse(req.query);
    const items = await listAuditLogForUser(req.user!.id, {
      limit: query.limit,
      action: query.action,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

export default router;
