import { Router, type IRouter, type Response } from "express";
import { DatabaseError } from "pg";
import { z } from "zod";
import {
  LoginBody,
  LoginResponse,
  GetCurrentUserResponse,
  RegisterBody,
} from "@workspace/api-zod";
import { handleAuthRouteError, requireAuth, requireAdmin } from "../middleware/auth";
import { loginRateLimiter } from "../middleware/security";
import { config } from "../lib/config";
import {
  assertAuthConfigured,
  AuthError,
  adminSetUserAdmin,
  adminSetUserDisabled,
  adminSetUserPassword,
  changePasswordForUser,
  listUsersForAdmin,
  loginUser,
  registerUser,
  toPublicUser,
  verifyAccessToken,
} from "../services/auth";
import {
  revokeAllAuthSessionsForUser,
  revokeAuthSession,
} from "../services/auth-sessions";
import { writeAuditLog } from "../services/audit";

const RegisterWithInviteBody = RegisterBody.extend({
  inviteCode: z.string().optional(),
});

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const AdminSetPasswordBody = z.object({
  newPassword: z.string().min(8),
});

const AdminSetDisabledBody = z.object({
  disabled: z.boolean(),
});

const AdminSetAdminBody = z.object({
  isAdmin: z.boolean(),
});

function setSessionCookie(res: Response, token: string): void {
  res.cookie(config.sessionCookieName, token, {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: "lax",
    maxAge: config.sessionCookieMaxAgeMs,
    path: "/",
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: "lax",
    path: "/",
  });
}

const router: IRouter = Router();

router.post("/auth/register", loginRateLimiter, async (req, res, next) => {
  try {
    assertAuthConfigured();
    const body = RegisterWithInviteBody.parse(req.body);

    const inviteOk =
      config.registerInviteCode != null &&
      body.inviteCode != null &&
      body.inviteCode === config.registerInviteCode;

    if (!config.allowPublicRegister && !inviteOk) {
      await writeAuditLog({
        userId: null,
        action: "register_blocked",
        entityType: "auth",
        entityId: null,
        metadata: { email: body.email.slice(0, 120) },
      });
      res.status(403).json({
        error: "REGISTRATION_DISABLED",
        message: "Public registration is disabled",
      });
      return;
    }

    if (body.password.length < 8) {
      throw new AuthError(
        "WEAK_PASSWORD",
        "Password must be at least 8 characters",
      );
    }
    const result = await registerUser(body);
    setSessionCookie(res, result.token);
    await writeAuditLog({
      userId: result.user.id,
      action: "register_success",
      entityType: "auth",
      entityId: result.user.id,
      metadata: { viaInvite: inviteOk },
    });
    res.status(201).json(
      LoginResponse.parse({
        user: result.user,
      }),
    );
  } catch (err) {
    if (err instanceof DatabaseError && err.code === "23505") {
      res.status(409).json({
        error: "EMAIL_IN_USE",
        message: "An account with this email already exists",
      });
      return;
    }
    handleAuthRouteError(err, res, next);
  }
});

router.post("/auth/login", loginRateLimiter, async (req, res, next) => {
  try {
    assertAuthConfigured();
    const body = LoginBody.parse(req.body);
    const result = await loginUser(body);
    setSessionCookie(res, result.token);
    await writeAuditLog({
      userId: result.user.id,
      action: "login_success",
      entityType: "auth",
      entityId: result.user.id,
      metadata: {},
    });
    res.json(
      LoginResponse.parse({
        user: result.user,
      }),
    );
  } catch (err) {
    if (err instanceof AuthError && err.code === "INVALID_CREDENTIALS") {
      await writeAuditLog({
        userId: null,
        action: "login_failure",
        entityType: "auth",
        entityId: null,
        metadata: {
          email:
            typeof req.body?.email === "string"
              ? req.body.email.slice(0, 120)
              : null,
        },
      });
    }
    handleAuthRouteError(err, res, next);
  }
});

router.post("/auth/logout", requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.authContext?.sessionId;
    if (sessionId) {
      await revokeAuthSession(sessionId, req.user!.id);
    }
    clearSessionCookie(res);
    await writeAuditLog({
      userId: req.user!.id,
      action: "logout",
      entityType: "auth",
      entityId: req.user!.id,
      metadata: { sessionId: sessionId ?? null },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Revoke every browser session for the signed-in user. */
router.post("/auth/logout-all", requireAuth, async (req, res, next) => {
  try {
    const count = await revokeAllAuthSessionsForUser(req.user!.id);
    clearSessionCookie(res);
    await writeAuditLog({
      userId: req.user!.id,
      action: "logout_all",
      entityType: "auth",
      entityId: req.user!.id,
      metadata: { revokedCount: count },
    });
    res.json({ ok: true, revokedCount: count });
  } catch (err) {
    next(err);
  }
});

/** Clear cookie even if session already invalid (best-effort logout). */
router.post("/auth/logout/public", async (req, res) => {
  const cookie = req.cookies?.[config.sessionCookieName];
  if (typeof cookie === "string" && cookie.trim()) {
    try {
      const payload = verifyAccessToken(cookie.trim());
      await revokeAuthSession(payload.jti, payload.sub);
    } catch {
      // Cookie may already be invalid / pre-revocation JWT — still clear it.
    }
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/auth/me", requireAuth, (req, res) => {
  const data = GetCurrentUserResponse.parse({ user: toPublicUser(req.user!) });
  res.json(data);
});

router.post("/auth/change-password", requireAuth, async (req, res, next) => {
  try {
    const body = ChangePasswordBody.parse(req.body);
    await changePasswordForUser({
      userId: req.user!.id,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    clearSessionCookie(res);
    await writeAuditLog({
      userId: req.user!.id,
      action: "password_changed",
      entityType: "auth",
      entityId: req.user!.id,
      metadata: {},
    });
    res.json({
      ok: true,
      message: "Password updated. Sign in again with your new password.",
    });
  } catch (err) {
    handleAuthRouteError(err, res, next);
  }
});

router.get("/admin/users", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const usersList = await listUsersForAdmin();
    res.json({ users: usersList });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/admin/users/:userId/password",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const userId = String(req.params.userId);
      const body = AdminSetPasswordBody.parse(req.body);
      await adminSetUserPassword({
        targetUserId: userId,
        newPassword: body.newPassword,
      });
      await writeAuditLog({
        userId: req.user!.id,
        action: "admin_set_password",
        entityType: "user",
        entityId: userId,
        metadata: {},
      });
      res.json({ ok: true });
    } catch (err) {
      handleAuthRouteError(err, res, next);
    }
  },
);

router.post(
  "/admin/users/:userId/disabled",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const userId = String(req.params.userId);
      const body = AdminSetDisabledBody.parse(req.body);
      const user = await adminSetUserDisabled({
        actorUserId: req.user!.id,
        targetUserId: userId,
        disabled: body.disabled,
      });
      await writeAuditLog({
        userId: req.user!.id,
        action: body.disabled ? "admin_disable_user" : "admin_enable_user",
        entityType: "user",
        entityId: userId,
        metadata: {},
      });
      res.json({ user });
    } catch (err) {
      handleAuthRouteError(err, res, next);
    }
  },
);

router.post(
  "/admin/users/:userId/admin",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const userId = String(req.params.userId);
      const body = AdminSetAdminBody.parse(req.body);
      const user = await adminSetUserAdmin({
        actorUserId: req.user!.id,
        targetUserId: userId,
        isAdmin: body.isAdmin,
      });
      await writeAuditLog({
        userId: req.user!.id,
        action: "admin_set_admin",
        entityType: "user",
        entityId: userId,
        metadata: { isAdmin: body.isAdmin },
      });
      res.json({ user });
    } catch (err) {
      handleAuthRouteError(err, res, next);
    }
  },
);

export default router;
