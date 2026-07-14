import cors from "cors";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { Express, RequestHandler } from "express";
import { config } from "../lib/config";

export function evaluateCorsRequest(input: {
  origin?: string;
  path: string;
  method: string;
}): { allowed: boolean; browserExtension: boolean } {
  const browserExtension = Boolean(
    input.origin && /^(chrome|moz)-extension:\/\//i.test(input.origin),
  );
  const sameOriginOrServer =
    !input.origin || config.corsOrigins.includes(input.origin);
  const extensionCaptureRequest =
    browserExtension &&
    input.path === "/api/captures" &&
    (input.method === "POST" || input.method === "OPTIONS");
  return {
    allowed: sameOriginOrServer || extensionCaptureRequest,
    browserExtension,
  };
}

export function applySecurityMiddleware(app: Express): void {
  // nginx / Cloudflare terminate TLS and set X-Forwarded-For
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: false, // SPA CSP is set by nginx-recall-app.conf
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(
    cors((req, callback) => {
      const origin = req.headers.origin;
      const decision = evaluateCorsRequest({
        origin,
        path: req.path,
        method: req.method,
      });

      if (!decision.allowed) {
        callback(new Error(`CORS blocked for origin: ${origin}`));
        return;
      }

      callback(null, {
        origin: true,
        // Extension auth is bearer-only; never expose browser cookies to it.
        credentials: !decision.browserExtension,
      });
    }),
  );
}

export const generalRateLimiter: RequestHandler = rateLimit({
  windowMs: config.generalRateLimitWindowMs,
  max: config.generalRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED", message: "Too many requests" },
});

export const aiRateLimiter: RequestHandler = rateLimit({
  windowMs: config.aiRateLimitWindowMs,
  max: config.aiRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "AI_RATE_LIMITED",
    message: "Too many AI requests — try again later",
  },
});

export const loginRateLimiter: RequestHandler = rateLimit({
  windowMs: config.loginRateLimitWindowMs,
  max: config.loginRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "LOGIN_RATE_LIMITED",
    message: "Too many login attempts — try again later",
  },
});
