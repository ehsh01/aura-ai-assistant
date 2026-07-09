import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  createConnectorForUser,
  getConnectorForUser,
  listConnectorsForUser,
  queryFinanceSummaryForUser,
  syncConnectorForUser,
} from "../services/connectors";

const CreateConnectorBody = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(["manual", "browser_extension", "csv_import", "finance_api", "ticket_email"]),
  description: z.string().max(2000).nullish(),
  baseUrl: z.string().url().nullish(),
  authType: z.string().max(32).nullish(),
  settings: z.record(z.unknown()).optional(),
});

const SyncConnectorBody = z.object({
  csvText: z.string().optional(),
  records: z.array(z.record(z.unknown())).optional(),
});

const router: IRouter = Router();
router.use(requireAuth);

router.get("/connectors", async (req, res, next) => {
  try {
    const items = await listConnectorsForUser(req.user!.id);
    res.json({ connectors: items });
  } catch (err) {
    next(err);
  }
});

router.post("/connectors", async (req, res, next) => {
  try {
    const body = CreateConnectorBody.parse(req.body);
    const connector = await createConnectorForUser(req.user!.id, body);
    res.status(201).json(connector);
  } catch (err) {
    next(err);
  }
});

router.get("/connectors/:connectorId", async (req, res, next) => {
  try {
    const connector = await getConnectorForUser(req.user!.id, req.params.connectorId);
    if (!connector) {
      res.status(404).json({ error: "NOT_FOUND", message: "Connector not found" });
      return;
    }
    res.json(connector);
  } catch (err) {
    next(err);
  }
});

router.post("/connectors/:connectorId/sync", async (req, res, next) => {
  try {
    const body = SyncConnectorBody.parse(req.body ?? {});
    const result = await syncConnectorForUser(req.user!.id, req.params.connectorId, body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/finance/summary", async (req, res, next) => {
  try {
    const connectorId = String(req.query.connectorId ?? "");
    if (!connectorId) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "connectorId is required" });
      return;
    }
    const summary = await queryFinanceSummaryForUser(req.user!.id, connectorId, {
      startDate: typeof req.query.startDate === "string" ? req.query.startDate : undefined,
      endDate: typeof req.query.endDate === "string" ? req.query.endDate : undefined,
      payee: typeof req.query.payee === "string" ? req.query.payee : undefined,
    });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

export default router;
