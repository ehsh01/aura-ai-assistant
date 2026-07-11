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
  createConnectorForUser,
  createGoogleConnectorForUser,
  getConnectorForUser,
  listConnectorsForUser,
  queryFinanceSummaryForUser,
  syncConnectorForUser,
  writeGoogleConnectAudit,
} from "../services/connectors";
import { ensureUserFinanceFresh } from "../services/finance-auto-sync";

const CreateConnectorBody = z.object({
  name: z.string().min(1).max(255),
  type: z.enum([
    "manual",
    "browser_extension",
    "csv_import",
    "finance_api",
    "ticket_email",
    "google",
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

const OAUTH_STATE_COOKIE = "recall_google_oauth_state";
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
    res.cookie(OAUTH_STATE_COOKIE, state, {
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
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
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
      typeof req.cookies?.[OAUTH_STATE_COOKIE] === "string"
        ? req.cookies[OAUTH_STATE_COOKIE]
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
    if (!tokens.refreshToken) {
      // Still create if we somehow only got access token — sync will fail later without refresh.
      // Prefer asking user to reconnect with consent.
    }

    const connector = await createGoogleConnectorForUser(verified.userId, {
      email: tokens.email,
      displayName: tokens.name,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    });

    await writeGoogleConnectAudit(verified.userId, connector.id, tokens.email);

    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
    res.redirect(frontendRedirect({ google: "connected", connectorId: connector.id }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "oauth_failed";
    const reason = message.includes("already connected")
      ? "already_connected"
      : "oauth_failed";
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
    res.redirect(frontendRedirect({ google: "error", reason }));
  }
});

router.use(requireAuth);

router.get("/connectors", async (req, res, next) => {
  try {
    const items = await listConnectorsForUser(req.user!.id);
    res.json({
      connectors: items,
      googleOAuthConfigured: isGoogleOAuthConfigured(),
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
