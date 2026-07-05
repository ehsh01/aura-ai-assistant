import type { NextFunction, Request, Response } from "express";
import {
  AuthError,
  getUserById,
  verifyAccessToken,
  type AuthUser,
} from "../services/auth";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Authentication required",
    });
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Authentication required",
    });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await getUserById(payload.sub);
    if (!user) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Session expired — sign in again",
      });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Invalid or expired token",
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
