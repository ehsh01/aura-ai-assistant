import type { NextFunction, Request, Response } from "express";
import {
  AuthError,
  getUserById,
  verifyAccessToken,
  type AuthUser,
} from "../services/auth";
import { assertAuthSessionActive } from "../services/auth-sessions";
import { config } from "../lib/config";
import {
  authenticateExtensionToken,
  isExtensionToken,
} from "../services/extension-tokens";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      authContext?: {
        kind: "session" | "extension";
        sessionId?: string;
        extensionTokenId?: string;
      };
    }
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token) return token;
  }
  return null;
}

function extractSessionCookie(req: Request): string | null {
  const cookie = req.cookies?.[config.sessionCookieName];
  if (typeof cookie === "string" && cookie.trim()) return cookie.trim();
  return null;
}

async function authenticateSessionToken(
  token: string,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const payload = verifyAccessToken(token);
    const sessionOk = await assertAuthSessionActive(payload.jti);
    if (!sessionOk) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Session expired — sign in again",
      });
      return;
    }
    const user = await getUserById(payload.sub);
    if (!user) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Session expired — sign in again",
      });
      return;
    }
    req.user = user;
    req.authContext = { kind: "session", sessionId: payload.jti };
    next();
  } catch (err) {
    if (err instanceof AuthError && err.code === "SESSION_REVOKED") {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: err.message,
      });
      return;
    }
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Invalid or expired token",
    });
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractSessionCookie(req);
  if (!token) {
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Authentication required",
    });
    return;
  }

  await authenticateSessionToken(token, req, res, next);
}

/**
 * Authentication boundary for raw capture creation.
 *
 * Web sessions retain normal cookie/JWT compatibility. Scoped extension tokens
 * are accepted only on routes that opt into this middleware.
 */
export async function requireCaptureAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const bearerToken = extractBearerToken(req);
  if (!bearerToken) {
    await requireAuth(req, res, next);
    return;
  }

  // Temporary compatibility: old extension JWTs remain valid only for raw
  // capture creation. Normal protected routes never accept bearer JWTs.
  if (!isExtensionToken(bearerToken)) {
    await authenticateSessionToken(bearerToken, req, res, next);
    return;
  }

  try {
    const extensionAuth = await authenticateExtensionToken(bearerToken);
    if (!extensionAuth) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Extension token is invalid, expired, or revoked",
      });
      return;
    }
    const user = await getUserById(extensionAuth.userId);
    if (!user) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Extension token owner no longer exists",
      });
      return;
    }
    req.user = user;
    req.authContext = {
      kind: "extension",
      extensionTokenId: extensionAuth.tokenId,
    };
    next();
  } catch {
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Extension token could not be validated",
    });
  }
}

export function handleAuthRouteError(
  err: unknown,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof AuthError) {
    const status =
      err.code === "INVALID_CREDENTIALS"
        ? 401
        : err.code === "WEAK_PASSWORD"
          ? 400
          : 503;
    res.status(status).json({ error: err.code, message: err.message });
    return;
  }
  next(err);
}
