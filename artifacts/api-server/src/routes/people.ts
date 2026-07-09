import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  createPersonForUser,
  getPersonForUser,
  getPersonRelatedForUser,
  listPeopleForUser,
  updatePersonForUser,
} from "../services/people";
import { listWaitingOnForUser } from "../services/waiting-on";

const CreatePersonBody = z.object({
  displayName: z.string().min(1).max(255),
  firstName: z.string().max(128).nullish(),
  lastName: z.string().max(128).nullish(),
  email: z.string().max(255).nullish(),
  phone: z.string().max(64).nullish(),
  organization: z.string().max(255).nullish(),
  department: z.string().max(255).nullish(),
  role: z.string().max(255).nullish(),
  notes: z.string().max(5000).nullish(),
});

const UpdatePersonBody = CreatePersonBody.partial();

const router: IRouter = Router();
router.use(requireAuth);

router.get("/people", async (req, res, next) => {
  try {
    const people = await listPeopleForUser(req.user!.id);
    res.json({ people });
  } catch (err) {
    next(err);
  }
});

/** Must be registered before /people/:personId so "waiting-on" is not treated as an id. */
router.get("/people/waiting-on", async (req, res, next) => {
  try {
    const items = await listWaitingOnForUser(req.user!.id);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post("/people", async (req, res, next) => {
  try {
    const body = CreatePersonBody.parse(req.body);
    const person = await createPersonForUser(req.user!.id, {
      ...body,
      email: body.email || null,
    });
    res.status(201).json(person);
  } catch (err) {
    next(err);
  }
});

router.get("/people/:personId", async (req, res, next) => {
  try {
    const person = await getPersonForUser(req.user!.id, req.params.personId);
    if (!person) {
      res.status(404).json({ error: "NOT_FOUND", message: "Person not found" });
      return;
    }
    res.json(person);
  } catch (err) {
    next(err);
  }
});

router.get("/people/:personId/related", async (req, res, next) => {
  try {
    const related = await getPersonRelatedForUser(req.user!.id, req.params.personId);
    if (!related) {
      res.status(404).json({ error: "NOT_FOUND", message: "Person not found" });
      return;
    }
    res.json(related);
  } catch (err) {
    next(err);
  }
});

router.patch("/people/:personId", async (req, res, next) => {
  try {
    const body = UpdatePersonBody.parse(req.body);
    const person = await updatePersonForUser(req.user!.id, req.params.personId, {
      ...body,
      email: body.email === "" ? null : body.email,
    });
    if (!person) {
      res.status(404).json({ error: "NOT_FOUND", message: "Person not found" });
      return;
    }
    res.json(person);
  } catch (err) {
    next(err);
  }
});

export default router;
