import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { config } from "../lib/config";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  isGoogleOAuthConfigured,
} from "../connectors/google";
import {
  buildHomeyAuthUrl,
  exchangeHomeyCode,
  isHomeyOAuthConfigured,
} from "../connectors/homey";
import {
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  isMicrosoftOAuthConfigured,
} from "../connectors/microsoft";
import {
  createConnectorForUser,
  createGoogleConnectorForUser,
  createHomeyConnectorForUser,
  createMicrosoftConnectorForUser,
  getConnectorForUser,
  getHomeyWebhookInfoForUser,
  listConnectorsForUser,
  rotateHomeyWebhookSecretForUser,
  syncConnectorForUser,
  writeGoogleConnectAudit,
  writeHomeyConnectAudit,
  writeMicrosoftConnectAudit,
} from "../services/connectors";
import {
  acknowledgeHomeyAlertForUser,
  listOpenHomeyAlertsForUser,
} from "../services/homey-alerts";
import { ensureUserFinanceFresh } from "../services/finance-auto-sync";
import {
  financeSummaryFromSynced,
  loadSyncedFinanceAggregate,
} from "../services/finance-sync";
import { todayIso } from "../services/query-utils";
import { listSubscriptionHeuristicsForUser } from "../services/subscriptions";

const CreateConnectorBody = z.object({
  name: z.string().min(1).max(255),
  type: z.enum([
    "manual",
    "browser_extension",
    "csv_import",
    "finance_api",
    "ticket_email",
    "google",
    "microsoft",
    "homey",
  ]),
  description: z.string().max(2000).nullish(),
  baseUrl: z.string().url().nullish(),
  authType: z.string().max(32).nullish(),
  settings: z.record(z.unknown()).optional(),
});

const SyncConnectorBody = z.object({
  csvText: z.string().optional(),
  records: z.array(z.record(z.unknown())).optional(),
});

const OAUTH_STATE_COOKIE_GOOGLE = "recall_google_oauth_state";
const OAUTH_STATE_COOKIE_MS = "recall_ms_oauth_state";
const OAUTH_STATE_COOKIE_HOMEY = "recall_homey_oauth_state";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function stateSecret(): string {
  return process.env.JWT_SECRET?.trim() || "dev-google-oauth-state";
}

function signOAuthState(userId: string): string {
  const nonce = randomBytes(16).toString("hex");
  const exp = String(Date.now() + OAUTH_STATE_TTL_MS);
  const payload = `${userId}.${exp}.${nonce}`;
  const sig = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyOAuthState(state: string): { userId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [userId, exp, nonce, sig] = parts;
  if (!userId || !exp || !nonce || !sig) return null;
  const payload = `${userId}.${exp}.${nonce}`;
  const expected = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  if (Number(exp) < Date.now()) return null;
  return { userId };
}

function frontendRedirect(query: Record<string, string>): string {
  const url = new URL("/connectors", config.appPublicUrl);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

const router: IRouter = Router();

// OAuth start requires a logged-in Recall session (cookie or bearer).
router.get("/connectors/google/oauth/start", requireAuth, async (req, res, next) => {
  try {
    if (!isGoogleOAuthConfigured()) {
      res.status(503).json({
        error: "GOOGLE_NOT_CONFIGURED",
        message: "Google OAuth is not configured on this server",
      });
      return;
    }
    const state = signOAuthState(req.user!.id);
    res.cookie(OAUTH_STATE_COOKIE_GOOGLE, state, {
      httpOnly: true,
      secure: config.sessionCookieSecure,
      sameSite: "lax",
      maxAge: OAUTH_STATE_TTL_MS,
      path: "/",
    });
    res.redirect(buildGoogleAuthUrl(state));
  } catch (err) {
    next(err);
  }
});

// Callback is a top-level browser redirect from Google; validate signed state.
router.get("/connectors/google/oauth/callback", async (req, res) => {
  const fail = (code: string) => {
    res.clearCookie(OAUTH_STATE_COOKIE_GOOGLE, { path: "/" });
    res.redirect(frontendRedirect({ google: "error", reason: code }));
  };

  try {
    if (!isGoogleOAuthConfigured()) {
      fail("not_configured");
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const cookieState =
      typeof req.cookies?.[OAUTH_STATE_COOKIE_GOOGLE] === "string"
        ? req.cookies[OAUTH_STATE_COOKIE_GOOGLE]
        : "";
    if (!code || !state) {
      fail("missing_code");
      return;
    }
    if (!cookieState || cookieState !== state) {
      fail("state_mismatch");
      return;
    }
    const verified = verifyOAuthState(state);
    if (!verified) {
      fail("state_invalid");
      return;
    }

    const tokens = await exchangeGoogleCode(code);

    const connector = await createGoogleConnectorForUser(verified.userId, {
      email: tokens.email,
      displayName: tokens.name,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    });

    await writeGoogleConnectAudit(verified.userId, connector.id, tokens.email);

    res.clearCookie(OAUTH_STATE_COOKIE_GOOGLE, { path: "/" });
    res.redirect(frontendRedirect({ google: "connected", connectorId: connector.id }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "oauth_failed";
    const reason = message.includes("already connected")
      ? "already_connected"
      : "oauth_failed";
    res.clearCookie(OAUTH_STATE_COOKIE_GOOGLE, { path: "/" });
    res.redirect(frontendRedirect({ google: "error", reason }));
  }
});

router.get("/connectors/microsoft/oauth/start", requireAuth, async (req, res, next) => {
  try {
    if (!isMicrosoftOAuthConfigured()) {
      res.status(503).json({
        error: "MICROSOFT_NOT_CONFIGURED",
        message: "Microsoft OAuth is not configured on this server",
      });
      return;
    }
    const state = signOAuthState(req.user!.id);
    res.cookie(OAUTH_STATE_COOKIE_MS, state, {
      httpOnly: true,
      secure: config.sessionCookieSecure,
      sameSite: "lax",
      maxAge: OAUTH_STATE_TTL_MS,
      path: "/",
    });
    res.redirect(buildMicrosoftAuthUrl(state));
  } catch (err) {
    next(err);
  }
});

router.get("/connectors/microsoft/oauth/callback", async (req, res) => {
  const fail = (code: string) => {
    res.clearCookie(OAUTH_STATE_COOKIE_MS, { path: "/" });
    res.redirect(frontendRedirect({ microsoft: "error", reason: code }));
  };

  try {
    if (!isMicrosoftOAuthConfigured()) {
      fail("not_configured");
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const cookieState =
      typeof req.cookies?.[OAUTH_STATE_COOKIE_MS] === "string"
        ? req.cookies[OAUTH_STATE_COOKIE_MS]
        : "";
    if (!code || !state) {
      fail("missing_code");
      return;
    }
    if (!cookieState || cookieState !== state) {
      fail("state_mismatch");
      return;
    }
    const verified = verifyOAuthState(state);
    if (!verified) {
      fail("state_invalid");
      return;
    }

    const tokens = await exchangeMicrosoftCode(code);
    const connector = await createMicrosoftConnectorForUser(verified.userId, {
      email: tokens.email,
      displayName: tokens.name,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    });
    await writeMicrosoftConnectAudit(verified.userId, connector.id, tokens.email);

    res.clearCookie(OAUTH_STATE_COOKIE_MS, { path: "/" });
    res.redirect(frontendRedirect({ microsoft: "connected", connectorId: connector.id }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "oauth_failed";
    const reason = message.includes("already connected")
      ? "already_connected"
      : "oauth_failed";
    res.clearCookie(OAUTH_STATE_COOKIE_MS, { path: "/" });
    res.redirect(frontendRedirect({ microsoft: "error", reason }));
  }
});

router.get("/connectors/homey/oauth/start", requireAuth, async (req, res, next) => {
  try {
    if (!isHomeyOAuthConfigured()) {
      res.status(503).json({
        error: "HOMEY_NOT_CONFIGURED",
        message: "Homey OAuth is not configured on this server",
      });
      return;
    }
    const state = signOAuthState(req.user!.id);
    res.cookie(OAUTH_STATE_COOKIE_HOMEY, state, {
      httpOnly: true,
      secure: config.sessionCookieSecure,
      sameSite: "lax",
      maxAge: OAUTH_STATE_TTL_MS,
      path: "/",
    });
    res.redirect(buildHomeyAuthUrl(state));
  } catch (err) {
    next(err);
  }
});

router.get("/connectors/homey/oauth/callback", async (req, res) => {
  const fail = (code: string) => {
    res.clearCookie(OAUTH_STATE_COOKIE_HOMEY, { path: "/" });
    res.redirect(frontendRedirect({ homey: "error", reason: code }));
  };

  try {
    if (!isHomeyOAuthConfigured()) {
      fail("not_configured");
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const cookieState =
      typeof req.cookies?.[OAUTH_STATE_COOKIE_HOMEY] === "string"
        ? req.cookies[OAUTH_STATE_COOKIE_HOMEY]
        : "";
    if (!code || !state) {
      fail("missing_code");
      return;
    }
    if (!cookieState || cookieState !== state) {
      fail("state_mismatch");
      return;
    }
    const verified = verifyOAuthState(state);
    if (!verified) {
      fail("state_invalid");
      return;
    }

    const tokens = await exchangeHomeyCode(code);
    const connector = await createHomeyConnectorForUser(verified.userId, {
      email: tokens.email,
      displayName: tokens.name,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      homeyId: tokens.homeyId,
      homeyName: tokens.homeyName,
      remoteUrl: tokens.remoteUrl,
    });
    await writeHomeyConnectAudit(verified.userId, connector.id, tokens.email);

    res.clearCookie(OAUTH_STATE_COOKIE_HOMEY, { path: "/" });
    res.redirect(frontendRedirect({ homey: "connected", connectorId: connector.id }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "oauth_failed";
    const reason = message.includes("already connected")
      ? "already_connected"
      : "oauth_failed";
    res.clearCookie(OAUTH_STATE_COOKIE_HOMEY, { path: "/" });
    res.redirect(frontendRedirect({ homey: "error", reason }));
  }
});

router.use(requireAuth);

router.get("/connectors", async (req, res, next) => {
  try {
    const items = await listConnectorsForUser(req.user!.id);
    res.json({
      connectors: items,
      googleOAuthConfigured: isGoogleOAuthConfigured(),
      microsoftOAuthConfigured: isMicrosoftOAuthConfigured(),
      homeyOAuthConfigured: isHomeyOAuthConfigured(),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/connectors", async (req, res, next) => {
  try {
    const body = CreateConnectorBody.parse(req.body);
    if (body.type === "google") {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Connect Google via OAuth (Connect Google button)",
      });
      return;
    }
    if (body.type === "microsoft") {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Connect Microsoft via OAuth (Connect Microsoft button)",
      });
      return;
    }
    if (body.type === "homey") {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Connect Homey via OAuth (Connect Homey button)",
      });
      return;
    }
    if (body.type === "ticket_email") {
      const settings = body.settings ?? {};
      const host = typeof settings.host === "string" ? settings.host.trim() : "";
      const user = typeof settings.user === "string" ? settings.user.trim() : "";
      const password = typeof settings.password === "string" ? settings.password : "";
      if (!host || !user || !password) {
        res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "ticket_email requires settings.host, settings.user, and settings.password",
        });
        return;
      }
    }
    const connector = await createConnectorForUser(req.user!.id, {
      ...body,
      authType: body.type === "ticket_email" ? body.authType ?? "imap" : body.authType,
    });
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

/** Refresh finance from MyFamilyBudget (called when the app opens). */
router.post("/finance/refresh", async (req, res, next) => {
  try {
    const result = await ensureUserFinanceFresh(req.user!.id, {
      maxAgeMs: 0,
      awaitSync: true,
    });
    res.json({ ok: true, ...result });
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
    const connector = await getConnectorForUser(req.user!.id, connectorId);
    if (!connector || connector.type !== "finance_api") {
      res.status(404).json({ error: "NOT_FOUND", message: "Finance connector not found" });
      return;
    }
    await ensureUserFinanceFresh(req.user!.id, { awaitSync: true });
    const synced = await loadSyncedFinanceAggregate(
      req.user!.id,
      "this month",
      todayIso(),
      {
        connectorId,
      startDate: typeof req.query.startDate === "string" ? req.query.startDate : undefined,
      endDate: typeof req.query.endDate === "string" ? req.query.endDate : undefined,
      payee: typeof req.query.payee === "string" ? req.query.payee : undefined,
      },
    );
    if (!synced) {
      res.status(404).json({ error: "NOT_FOUND", message: "Finance summary unavailable" });
      return;
    }
    res.json(financeSummaryFromSynced(synced));
  } catch (err) {
    next(err);
  }
});

router.get("/finance/subscriptions", async (req, res, next) => {
  try {
    const subscriptions = await listSubscriptionHeuristicsForUser(req.user!.id);
    res.json({ subscriptions });
  } catch (err) {
    next(err);
  }
});

router.get("/connectors/:connectorId/homey-webhook", async (req, res, next) => {
  try {
    const info = await getHomeyWebhookInfoForUser(
      req.user!.id,
      req.params.connectorId,
      config.appPublicUrl,
    );
    if (!info) {
      res.status(404).json({ error: "NOT_FOUND", message: "Homey connector not found" });
      return;
    }
    res.json(info);
  } catch (err) {
    next(err);
  }
});

router.post("/connectors/:connectorId/homey-webhook/rotate", async (req, res, next) => {
  try {
    const info = await rotateHomeyWebhookSecretForUser(
      req.user!.id,
      req.params.connectorId,
      config.appPublicUrl,
    );
    if (!info) {
      res.status(404).json({ error: "NOT_FOUND", message: "Homey connector not found" });
      return;
    }
    res.json(info);
  } catch (err) {
    next(err);
  }
});

router.post("/connectors/:connectorId/homey-webhook/test", async (req, res, next) => {
  try {
    const connector = await getConnectorForUser(req.user!.id, req.params.connectorId);
    if (!connector || connector.type !== "homey") {
      res.status(404).json({ error: "NOT_FOUND", message: "Homey connector not found" });
      return;
    }
    const { ingestHomeyAlertForUser } = await import("../services/homey-alerts");
    const result = await ingestHomeyAlertForUser(req.user!.id, connector.id, {
      title: "Recall Homey test alert",
      message: "This is a test from Connectors. Your Homey webhook path is working.",
      severity: "info",
      kind: "other",
      deviceName: "Recall",
    });
    res.json({ ok: true, result });
  } catch (err) {
    next(err);
  }
});

router.get("/homey/alerts", async (req, res, next) => {
  try {
    const alerts = await listOpenHomeyAlertsForUser(req.user!.id);
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

router.post("/homey/alerts/:alertId/ack", async (req, res, next) => {
  try {
    const ok = await acknowledgeHomeyAlertForUser(req.user!.id, req.params.alertId);
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Alert not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
