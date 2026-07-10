import cors from "cors";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { Express, RequestHandler } from "express";
import { config } from "../lib/config";

export function applySecurityMiddleware(app: Express): void {
  // nginx / Cloudflare terminate TLS and set X-Forwarded-For
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: false, // static SPA served by nginx
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and server-to-server (no Origin header)
        if (!origin) {
          callback(null, true);
          return;
        }
        if (config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
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
