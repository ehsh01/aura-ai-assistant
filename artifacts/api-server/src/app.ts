import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { ZodError } from "zod";
import router from "./routes";
import { config } from "./lib/config";
import { logger } from "./lib/logger";
import {
  aiRateLimiter,
  applySecurityMiddleware,
  generalRateLimiter,
} from "./middleware/security";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
applySecurityMiddleware(app);
app.use(cookieParser());
app.use(express.json({ limit: config.jsonLimit }));
app.use(express.urlencoded({ extended: true, limit: config.jsonLimit }));
app.use("/api", generalRateLimiter, router);

function asZodError(err: unknown): ZodError | null {
  if (err instanceof ZodError) return err;
  // Schemas may be validated by a different zod build (e.g. zod/v4), so the
  // thrown error can be a structurally-identical ZodError from another class.
  if (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "ZodError" &&
    Array.isArray((err as { issues?: unknown }).issues)
  ) {
    return err as ZodError;
  }
  return null;
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const zodErr = asZodError(err);
  if (zodErr) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Request body failed validation",
      ...(config.isProduction ? {} : { issues: zodErr.issues }),
    });
    return;
  }

  if (err instanceof Error && err.message.startsWith("CORS blocked")) {
    res.status(403).json({ error: "CORS_FORBIDDEN", message: "Origin not allowed" });
    return;
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong" });
});

export default app;
