import { Router, type IRouter } from "express";
import { ListNotebooksResponse } from "@workspace/api-zod";
import { requireAuth } from "../middleware/auth";
import { listNotebooksForUser } from "../services/notebooks";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/notebooks", async (req, res, next) => {
  try {
    const notebooks = await listNotebooksForUser(req.user!.id);
    res.json(ListNotebooksResponse.parse({ notebooks }));
  } catch (err) {
    next(err);
  }
});

export default router;
