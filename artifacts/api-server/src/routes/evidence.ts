import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import {
  getEvidenceForUser,
  listEvidenceForEntity,
} from "../services/evidence";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/evidence/:evidenceId", async (req, res, next) => {
  try {
    const evidence = await getEvidenceForUser(req.user!.id, req.params.evidenceId);
    if (!evidence) {
      res.status(404).json({ error: "NOT_FOUND", message: "Evidence not found" });
      return;
    }
    res.json(evidence);
  } catch (err) {
    next(err);
  }
});

router.get("/entities/:entityType/:entityId/evidence", async (req, res, next) => {
  try {
    const items = await listEvidenceForEntity(
      req.user!.id,
      req.params.entityType,
      req.params.entityId,
    );
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

export default router;
