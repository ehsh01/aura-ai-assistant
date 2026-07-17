import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  createVehicleForUser,
  deleteVehicleForUser,
  getVehicleForUser,
  listVehiclesForUser,
  updateVehicleForUser,
} from "../services/vehicles";
import {
  createHomeForUser,
  deleteHomeForUser,
  getHomeForUser,
  listHomesForUser,
  updateHomeForUser,
} from "../services/homes";
import {
  createWarrantyForUser,
  deleteWarrantyForUser,
  getWarrantyForUser,
  listWarrantiesForUser,
  updateWarrantyForUser,
} from "../services/warranties";
import {
  getSubjectSpendForUser,
  linkSubjectExpense,
  suggestSubjectSpendForUser,
  unlinkSubjectExpense,
} from "../services/subject-spend";

const CreateVehicleBody = z.object({
  displayName: z.string().min(1).max(255),
  year: z.string().max(16).nullish(),
  make: z.string().max(128).nullish(),
  model: z.string().max(128).nullish(),
  vin: z.string().max(64).nullish(),
  licensePlate: z.string().max(32).nullish(),
  notes: z.string().max(5000).nullish(),
});

const UpdateVehicleBody = CreateVehicleBody.partial();

const CreateHomeBody = z.object({
  displayName: z.string().min(1).max(255),
  addressLine1: z.string().max(255).nullish(),
  addressLine2: z.string().max(255).nullish(),
  city: z.string().max(128).nullish(),
  region: z.string().max(64).nullish(),
  postalCode: z.string().max(32).nullish(),
  notes: z.string().max(5000).nullish(),
});

const UpdateHomeBody = CreateHomeBody.partial();

const CreateWarrantyBody = z.object({
  title: z.string().min(1).max(500),
  subjectType: z.enum(["vehicle", "home", "other"]).optional(),
  subjectId: z.string().max(64).nullish(),
  provider: z.string().max(255).nullish(),
  expiresAt: z.string().max(10).nullish(),
  notes: z.string().max(5000).nullish(),
});

const UpdateWarrantyBody = CreateWarrantyBody.partial();

const router: IRouter = Router();
router.use(requireAuth);

router.get("/vehicles", async (req, res, next) => {
  try {
    const vehicles = await listVehiclesForUser(req.user!.id);
    res.json({ vehicles });
  } catch (err) {
    next(err);
  }
});

router.post("/vehicles", async (req, res, next) => {
  try {
    const body = CreateVehicleBody.parse(req.body);
    const vehicle = await createVehicleForUser(req.user!.id, body);
    res.status(201).json(vehicle);
  } catch (err) {
    next(err);
  }
});

router.get("/vehicles/:vehicleId", async (req, res, next) => {
  try {
    const vehicle = await getVehicleForUser(req.user!.id, req.params.vehicleId);
    if (!vehicle) {
      res.status(404).json({ error: "NOT_FOUND", message: "Vehicle not found" });
      return;
    }
    res.json(vehicle);
  } catch (err) {
    next(err);
  }
});

router.patch("/vehicles/:vehicleId", async (req, res, next) => {
  try {
    const body = UpdateVehicleBody.parse(req.body);
    const vehicle = await updateVehicleForUser(req.user!.id, req.params.vehicleId, body);
    if (!vehicle) {
      res.status(404).json({ error: "NOT_FOUND", message: "Vehicle not found" });
      return;
    }
    res.json(vehicle);
  } catch (err) {
    next(err);
  }
});

router.delete("/vehicles/:vehicleId", async (req, res, next) => {
  try {
    const ok = await deleteVehicleForUser(req.user!.id, req.params.vehicleId);
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Vehicle not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get("/vehicles/:vehicleId/spend", async (req, res, next) => {
  try {
    const spend = await getSubjectSpendForUser(req.user!.id, "vehicle", req.params.vehicleId);
    if (!spend) {
      res.status(404).json({ error: "NOT_FOUND", message: "Vehicle not found" });
      return;
    }
    res.json(spend);
  } catch (err) {
    next(err);
  }
});

router.get("/vehicles/:vehicleId/spend/suggest", async (req, res, next) => {
  try {
    const result = await suggestSubjectSpendForUser(
      req.user!.id,
      "vehicle",
      req.params.vehicleId,
    );
    if (!result) {
      res.status(404).json({ error: "NOT_FOUND", message: "Vehicle not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/vehicles/:vehicleId/spend/link", async (req, res, next) => {
  try {
    const body = z.object({ sourceRecordId: z.string().min(1).max(64) }).parse(req.body);
    const result = await linkSubjectExpense(
      req.user!.id,
      "vehicle",
      req.params.vehicleId,
      body.sourceRecordId,
    );
    if (!result.ok) {
      res.status(404).json({ error: "NOT_FOUND", message: result.error });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/vehicles/:vehicleId/spend/unlink", async (req, res, next) => {
  try {
    const body = z.object({ sourceRecordId: z.string().min(1).max(64) }).parse(req.body);
    const ok = await unlinkSubjectExpense(
      req.user!.id,
      "vehicle",
      req.params.vehicleId,
      body.sourceRecordId,
    );
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Link not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/homes", async (req, res, next) => {
  try {
    const homes = await listHomesForUser(req.user!.id);
    res.json({ homes });
  } catch (err) {
    next(err);
  }
});

router.post("/homes", async (req, res, next) => {
  try {
    const body = CreateHomeBody.parse(req.body);
    const home = await createHomeForUser(req.user!.id, body);
    res.status(201).json(home);
  } catch (err) {
    next(err);
  }
});

router.get("/homes/:homeId", async (req, res, next) => {
  try {
    const home = await getHomeForUser(req.user!.id, req.params.homeId);
    if (!home) {
      res.status(404).json({ error: "NOT_FOUND", message: "Home not found" });
      return;
    }
    res.json(home);
  } catch (err) {
    next(err);
  }
});

router.patch("/homes/:homeId", async (req, res, next) => {
  try {
    const body = UpdateHomeBody.parse(req.body);
    const home = await updateHomeForUser(req.user!.id, req.params.homeId, body);
    if (!home) {
      res.status(404).json({ error: "NOT_FOUND", message: "Home not found" });
      return;
    }
    res.json(home);
  } catch (err) {
    next(err);
  }
});

router.delete("/homes/:homeId", async (req, res, next) => {
  try {
    const ok = await deleteHomeForUser(req.user!.id, req.params.homeId);
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Home not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get("/homes/:homeId/spend", async (req, res, next) => {
  try {
    const spend = await getSubjectSpendForUser(req.user!.id, "home", req.params.homeId);
    if (!spend) {
      res.status(404).json({ error: "NOT_FOUND", message: "Home not found" });
      return;
    }
    res.json(spend);
  } catch (err) {
    next(err);
  }
});

router.get("/homes/:homeId/spend/suggest", async (req, res, next) => {
  try {
    const result = await suggestSubjectSpendForUser(req.user!.id, "home", req.params.homeId);
    if (!result) {
      res.status(404).json({ error: "NOT_FOUND", message: "Home not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/homes/:homeId/spend/link", async (req, res, next) => {
  try {
    const body = z.object({ sourceRecordId: z.string().min(1).max(64) }).parse(req.body);
    const result = await linkSubjectExpense(
      req.user!.id,
      "home",
      req.params.homeId,
      body.sourceRecordId,
    );
    if (!result.ok) {
      res.status(404).json({ error: "NOT_FOUND", message: result.error });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/homes/:homeId/spend/unlink", async (req, res, next) => {
  try {
    const body = z.object({ sourceRecordId: z.string().min(1).max(64) }).parse(req.body);
    const ok = await unlinkSubjectExpense(
      req.user!.id,
      "home",
      req.params.homeId,
      body.sourceRecordId,
    );
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Link not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/warranties", async (req, res, next) => {
  try {
    const warranties = await listWarrantiesForUser(req.user!.id);
    res.json({ warranties });
  } catch (err) {
    next(err);
  }
});

router.post("/warranties", async (req, res, next) => {
  try {
    const body = CreateWarrantyBody.parse(req.body);
    const warranty = await createWarrantyForUser(req.user!.id, body);
    res.status(201).json(warranty);
  } catch (err) {
    next(err);
  }
});

router.get("/warranties/:warrantyId", async (req, res, next) => {
  try {
    const warranty = await getWarrantyForUser(req.user!.id, req.params.warrantyId);
    if (!warranty) {
      res.status(404).json({ error: "NOT_FOUND", message: "Warranty not found" });
      return;
    }
    res.json(warranty);
  } catch (err) {
    next(err);
  }
});

router.patch("/warranties/:warrantyId", async (req, res, next) => {
  try {
    const body = UpdateWarrantyBody.parse(req.body);
    const warranty = await updateWarrantyForUser(req.user!.id, req.params.warrantyId, body);
    if (!warranty) {
      res.status(404).json({ error: "NOT_FOUND", message: "Warranty not found" });
      return;
    }
    res.json(warranty);
  } catch (err) {
    next(err);
  }
});

router.delete("/warranties/:warrantyId", async (req, res, next) => {
  try {
    const ok = await deleteWarrantyForUser(req.user!.id, req.params.warrantyId);
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Warranty not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
