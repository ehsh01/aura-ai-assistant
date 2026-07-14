import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { connectors } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { openConnectorSettings } from "../lib/secret-box";
import { verifyHomeyWebhookSecret } from "../connectors/homey";
import { ingestHomeyAlertForUser } from "../services/homey-alerts";

const HomeyWebhookBody = z.object({
  title: z.string().min(1).max(400),
  message: z.string().max(4000).nullish(),
  severity: z.enum(["info", "warn", "emergency"]).nullish(),
  deviceName: z.string().max(300).nullish(),
  kind: z.string().max(100).nullish(),
  homeyDeviceId: z.string().max(128).nullish(),
});

const router: IRouter = Router();

/**
 * Homey Flow → Recall alert ingress (no session cookie).
 * Auth: Authorization: Bearer <webhookSecret> or X-Recall-Homey-Secret header.
 */
router.post("/webhooks/homey/:connectorId", async (req, res, next) => {
  try {
    const connectorId = String(req.params.connectorId ?? "");
    if (!connectorId) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "connectorId required" });
      return;
    }

    const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const headerSecret =
      typeof req.headers["x-recall-homey-secret"] === "string"
        ? req.headers["x-recall-homey-secret"]
        : "";
    const querySecret =
      typeof req.query.secret === "string" ? req.query.secret : "";
    const provided = bearer || headerSecret || querySecret;

    const rows = await getDb()
      .select()
      .from(connectors)
      .where(and(eq(connectors.id, connectorId), eq(connectors.type, "homey")))
      .limit(1);
    const conn = rows[0];
    if (!conn || !conn.enabled) {
      res.status(404).json({ error: "NOT_FOUND", message: "Homey connector not found" });
      return;
    }

    const settings = openConnectorSettings(
      (conn.settings ?? {}) as Record<string, unknown>,
    );
    const expected =
      typeof settings.webhookSecret === "string" ? settings.webhookSecret : null;
    if (!verifyHomeyWebhookSecret(provided, expected)) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid Homey webhook secret" });
      return;
    }

    const body = HomeyWebhookBody.parse(req.body ?? {});
    const result = await ingestHomeyAlertForUser(conn.userId, connectorId, body);
    if (!result) {
      res.status(202).json({ ok: true, filtered: true });
      return;
    }
    res.status(result.filtered ? 202 : 201).json({
      ok: true,
      recordId: result.recordId || null,
      deduped: result.deduped,
      filtered: result.filtered,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
