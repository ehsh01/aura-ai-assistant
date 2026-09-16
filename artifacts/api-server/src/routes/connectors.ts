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
  beginEvernoteOAuth,
  exchangeEvernoteOAuth,
  isEvernoteDeveloperTokenConfigured,
  isEvernoteEdamFallbackConfigured,
} from "../connectors/evernote";
import { evernoteMcpFailureReason } from "../connectors/evernote-errors";
import {
  beginEvernoteMcpOAuthForUser,
  createEvernoteConnectorForUser,
  createEvernoteConnectorFromDeveloperTokenForUser,
  createConnectorForUser,
  deleteConnectorForUser,
  upsertFlipperForceConnectorForUser,
  testFlipperForceConnectorForUser,
  createGoogleConnectorForUser,
  createHomeyConnectorForUser,
  createMicrosoftConnectorForUser,
  getConnectorForUser,
  getHomeyWebhookInfoForUser,
  listConnectorsForUser,
  listConnectorSyncRunsForUser,
  rotateHomeyWebhookSecretForUser,
  syncConnectorForUser,
  finishEvernoteMcpOAuthForUser,
  testEvernoteConnectorForUser,
  updateConnectorForUser,
  writeGoogleConnectAudit,
  writeEvernoteConnectAudit,
  writeHomeyConnectAudit,
  writeMicrosoftConnectAudit,
} from "../services/connectors";
import { openSecret, sealSecret } from "../lib/secret-box";
import {
  acknowledgeHomeyAlertForUser,
  listOpenHomeyAlertsForUser,
} from "../services/homey-alerts";
import {
  ensureUserFinanceFresh,
  ON_DEMAND_SYNC_TIMEOUT_MS,
} from "../services/finance-auto-sync";
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
    "flipperforce",
    "evernote",
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

const PatchConnectorBody = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().min(1).max(255).optional(),
  })
  .refine((body) => body.enabled !== undefined || body.name !== undefined, {
    message: "At least one connector field is required",
  });

const OAUTH_STATE_COOKIE_GOOGLE = "recall_google_oauth_state";
const OAUTH_STATE_COOKIE_MS = "recall_ms_oauth_state";
const OAUTH_STATE_COOKIE_HOMEY = "recall_homey_oauth_state";
const OAUTH_STATE_COOKIE_EVERNOTE_MCP = "recall_evernote_mcp_oauth_state";
const OAUTH_STATE_COOKIE_EVERNOTE_EDAM = "recall_evernote_edam_oauth_state";
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

router.get("/connectors/evernote/oauth/start", requireAuth, async (req, res) => {
  try {
    const state = signOAuthState(req.user!.id);
    const started = await beginEvernoteMcpOAuthForUser(req.user!.id, state);
    res.cookie(
      OAUTH_STATE_COOKIE_EVERNOTE_MCP,
      sealSecret(
        JSON.stringify({
          state,
          connectorId: started.connectorId,
        }),
      ),
      {
        httpOnly: true,
        secure: config.sessionCookieSecure,
        sameSite: "lax",
        maxAge: OAUTH_STATE_TTL_MS,
        path: "/",
      },
    );
    res.redirect(started.authorizeUrl);
  } catch (err) {
    res.redirect(
      frontendRedirect({
        evernote: "error",
        reason: evernoteMcpFailureReason(err),
      }),
    );
  }
});

router.get("/connectors/evernote/oauth/callback", async (req, res) => {
  const fail = (code: string) => {
    res.clearCookie(OAUTH_STATE_COOKIE_EVERNOTE_MCP, { path: "/" });
    res.redirect(frontendRedirect({ evernote: "error", reason: code }));
  };
  try {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const cookieValue =
      typeof req.cookies?.[OAUTH_STATE_COOKIE_EVERNOTE_MCP] === "string"
        ? req.cookies[OAUTH_STATE_COOKIE_EVERNOTE_MCP]
        : "";
    if (!state || !cookieValue) {
      fail("missing_code");
      return;
    }
    const pending = JSON.parse(openSecret(cookieValue)) as {
      state?: string;
      connectorId?: string;
    };
    const verified = verifyOAuthState(state);
    if (
      !verified ||
      pending.state !== state ||
      typeof pending.connectorId !== "string"
    ) {
      fail("state_mismatch");
      return;
    }
    const callbackParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") callbackParams.set(key, value);
    }
    const connector = await finishEvernoteMcpOAuthForUser(
      verified.userId,
      pending.connectorId,
      state,
      callbackParams,
    );
    await writeEvernoteConnectAudit(verified.userId, connector.id, "mcp");
    res.clearCookie(OAUTH_STATE_COOKIE_EVERNOTE_MCP, { path: "/" });
    res.redirect(
      frontendRedirect({ evernote: "connected", connectorId: connector.id }),
    );
  } catch (error) {
    fail(evernoteMcpFailureReason(error));
  }
});

router.get("/connectors/evernote/edam/oauth/start", requireAuth, async (req, res, next) => {
  try {
    if (!isEvernoteEdamFallbackConfigured()) {
      res.status(503).json({
        error: "EVERNOTE_EDAM_NOT_CONFIGURED",
        message: "Evernote EDAM fallback is not enabled on this server",
      });
      return;
    }
    const state = signOAuthState(req.user!.id);
    const request = await beginEvernoteOAuth(state);
    const temporary = sealSecret(
      JSON.stringify({
        state,
        oauthToken: request.oauthToken,
        oauthTokenSecret: request.oauthTokenSecret,
      }),
    );
    res.cookie(OAUTH_STATE_COOKIE_EVERNOTE_EDAM, temporary, {
      httpOnly: true,
      secure: config.sessionCookieSecure,
      sameSite: "lax",
      maxAge: OAUTH_STATE_TTL_MS,
      path: "/",
    });
    res.redirect(request.authorizeUrl);
  } catch (err) {
    next(err);
  }
});

router.get("/connectors/evernote/edam/oauth/callback", async (req, res) => {
  const fail = (code: string) => {
    res.clearCookie(OAUTH_STATE_COOKIE_EVERNOTE_EDAM, { path: "/" });
    res.redirect(frontendRedirect({ evernote: "error", reason: code }));
  };

  try {
    if (!isEvernoteEdamFallbackConfigured()) {
      fail("not_configured");
      return;
    }
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const oauthToken =
      typeof req.query.oauth_token === "string" ? req.query.oauth_token : "";
    const oauthVerifier =
      typeof req.query.oauth_verifier === "string"
        ? req.query.oauth_verifier
        : "";
    const cookieValue =
      typeof req.cookies?.[OAUTH_STATE_COOKIE_EVERNOTE_EDAM] === "string"
        ? req.cookies[OAUTH_STATE_COOKIE_EVERNOTE_EDAM]
        : "";
    if (!state || !oauthToken || !oauthVerifier || !cookieValue) {
      fail("missing_verifier");
      return;
    }

    const temporary = JSON.parse(openSecret(cookieValue)) as {
      state?: string;
      oauthToken?: string;
      oauthTokenSecret?: string;
    };
    if (
      temporary.state !== state ||
      temporary.oauthToken !== oauthToken ||
      !temporary.oauthTokenSecret
    ) {
      fail("state_mismatch");
      return;
    }
    const verified = verifyOAuthState(state);
    if (!verified) {
      fail("state_invalid");
      return;
    }

    const tokens = await exchangeEvernoteOAuth({
      oauthToken,
      oauthTokenSecret: temporary.oauthTokenSecret,
      oauthVerifier,
    });
    const connector = await createEvernoteConnectorForUser(verified.userId, {
      accountId: tokens.accountId,
      accountName: tokens.accountName,
      accountEmail: tokens.accountEmail,
      accessToken: tokens.accessToken,
      noteStoreUrl: tokens.noteStoreUrl,
      webApiUrlPrefix: tokens.webApiUrlPrefix,
      expiresAt: tokens.expiresAt,
    });
    await writeEvernoteConnectAudit(
      verified.userId,
      connector.id,
      tokens.accountId,
    );

    res.clearCookie(OAUTH_STATE_COOKIE_EVERNOTE_EDAM, { path: "/" });
    res.redirect(
      frontendRedirect({ evernote: "connected", connectorId: connector.id }),
    );
  } catch {
    fail("oauth_failed");
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
      // MCP OAuth2+DCR is the default and requires no static consumer secret.
      evernoteOAuthConfigured: true,
      evernoteMcpEnabled: true,
      evernoteEdamFallbackConfigured: isEvernoteEdamFallbackConfigured(),
      evernoteDeveloperTokenConfigured: isEvernoteDeveloperTokenConfigured(),
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
    if (body.type === "evernote") {
      if (!isEvernoteDeveloperTokenConfigured()) {
        res.status(400).json({
          error: "VALIDATION_ERROR",
          message:
            "Connect Evernote via OAuth, or configure EVERNOTE_DEVELOPER_TOKEN for single-user v1",
        });
        return;
      }
      const connected =
        await createEvernoteConnectorFromDeveloperTokenForUser(req.user!.id);
      await writeEvernoteConnectAudit(
        req.user!.id,
        connected.id,
        connected.evernoteAccountId,
      );
      const { evernoteAccountId: _accountId, ...connector } = connected;
      res.status(201).json(connector);
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
    if (body.type === "flipperforce") {
      const apiKey =
        typeof body.settings?.apiKey === "string" ? body.settings.apiKey.trim() : "";
      if (!apiKey) {
        res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "flipperforce requires settings.apiKey",
        });
        return;
      }
      try {
        const connector = await upsertFlipperForceConnectorForUser(req.user!.id, apiKey);
        res.status(201).json(connector);
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err && typeof err.status === "number"
            ? err.status
            : 502;
        res.status(status === 401 ? 401 : 502).json({
          error: status === 401 ? "AUTH_FAILED" : "UPSTREAM_ERROR",
          message:
            err instanceof Error
              ? err.message
              : "Could not verify FlipperForce API key",
        });
      }
      return;
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

router.patch("/connectors/:connectorId", async (req, res, next) => {
  try {
    const body = PatchConnectorBody.parse(req.body ?? {});
    const connector = await updateConnectorForUser(
      req.user!.id,
      req.params.connectorId,
      body,
    );
    if (!connector) {
      res.status(404).json({ error: "NOT_FOUND", message: "Connector not found" });
      return;
    }
    res.json(connector);
  } catch (err) {
    next(err);
  }
});

router.get("/connectors/:connectorId/sync-runs", async (req, res, next) => {
  try {
    const requestedLimit = Number(req.query.limit ?? 25);
    const runs = await listConnectorSyncRunsForUser(
      req.user!.id,
      req.params.connectorId,
      Number.isFinite(requestedLimit) ? requestedLimit : 25,
    );
    if (!runs) {
      res.status(404).json({ error: "NOT_FOUND", message: "Connector not found" });
      return;
    }
    res.json({ runs });
  } catch (err) {
    next(err);
  }
});

router.post("/connectors/:connectorId/test", async (req, res, next) => {
  try {
    const connector = await getConnectorForUser(req.user!.id, req.params.connectorId);
    if (!connector) {
      res.status(404).json({ error: "NOT_FOUND", message: "Connector not found" });
      return;
    }
    const result =
      connector.type === "flipperforce"
        ? await testFlipperForceConnectorForUser(
            req.user!.id,
            req.params.connectorId,
          )
        : connector.type === "evernote"
          ? await testEvernoteConnectorForUser(
              req.user!.id,
              req.params.connectorId,
            )
          : null;
    if (!result) {
      res.status(400).json({
        error: "UNSUPPORTED_OPERATION",
        message: `Connection test is not supported for ${connector.type}`,
      });
      return;
    }
    res.json(result);
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err && typeof err.status === "number"
        ? err.status
        : 502;
    const responseStatus = status === 401 || status === 429 ? status : 502;
    res.status(responseStatus).json({
      error:
        responseStatus === 401
          ? "AUTH_FAILED"
          : responseStatus === 429
            ? "RATE_LIMITED"
            : "UPSTREAM_ERROR",
      message: err instanceof Error ? err.message : "Connector test failed",
    });
  }
});

router.delete("/connectors/:connectorId", async (req, res, next) => {
  try {
    const ok = await deleteConnectorForUser(req.user!.id, req.params.connectorId);
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Connector not found" });
      return;
    }
    res.json({ ok: true });
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
    // The app shell calls this on every mount. Forcing a sync each time (and
    // waiting for all of it) let refreshes stack until the process ran out of
    // heap, so keep the normal cooldown and stop waiting after the timeout —
    // the sync itself continues in the background either way.
    const result = await ensureUserFinanceFresh(req.user!.id, {
      awaitSync: true,
      timeoutMs: ON_DEMAND_SYNC_TIMEOUT_MS,
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
    await ensureUserFinanceFresh(req.user!.id, {
      awaitSync: true,
      timeoutMs: ON_DEMAND_SYNC_TIMEOUT_MS,
    });
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
