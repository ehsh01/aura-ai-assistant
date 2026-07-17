import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  createUserRuleForUser,
  deleteUserRuleForUser,
  listUserRulesForUser,
  updateUserRuleForUser,
} from "../services/user-rules";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/user-rules", async (req, res, next) => {
  try {
    const rules = await listUserRulesForUser(req.user!.id);
    res.json({ rules });
  } catch (err) {
    next(err);
  }
});

router.post("/user-rules", async (req, res, next) => {
  try {
    const body = z.object({ body: z.string().min(1).max(500) }).parse(req.body);
    const rule = await createUserRuleForUser(req.user!.id, body.body);
    res.status(201).json(rule);
  } catch (err) {
    if (err instanceof Error && err.message.includes("At most")) {
      res.status(400).json({ error: "LIMIT", message: err.message });
      return;
    }
    next(err);
  }
});

router.patch("/user-rules/:ruleId", async (req, res, next) => {
  try {
    const body = z
      .object({
        body: z.string().min(1).max(500).optional(),
        enabled: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      })
      .parse(req.body);
    const rule = await updateUserRuleForUser(req.user!.id, req.params.ruleId, body);
    if (!rule) {
      res.status(404).json({ error: "NOT_FOUND", message: "Rule not found" });
      return;
    }
    res.json(rule);
  } catch (err) {
    next(err);
  }
});

router.delete("/user-rules/:ruleId", async (req, res, next) => {
  try {
    const ok = await deleteUserRuleForUser(req.user!.id, req.params.ruleId);
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Rule not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
