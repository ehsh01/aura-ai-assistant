import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { getWorkingContextForUser, setWorkingContextForUser } from "../services/working-context";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/context", async (req, res, next) => {
  try {
    res.json(await getWorkingContextForUser(req.user!.id));
  } catch (err) {
    next(err);
  }
});

const Body = z.object({
  personId: z.string().max(64).nullable().optional(),
  projectId: z.string().max(64).nullable().optional(),
});

router.put("/context", async (req, res, next) => {
  try {
    const body = Body.parse(req.body ?? {});
    res.json(await setWorkingContextForUser(req.user!.id, body));
  } catch (err) {
    next(err);
  }
});

export default router;
