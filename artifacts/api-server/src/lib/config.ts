const isProduction = process.env.NODE_ENV === "production";

/** Comma-separated origins; defaults lock production to recall-app.net */
const defaultOrigins = isProduction
  ? "https://recall-app.net,https://www.recall-app.net"
  : "http://localhost:5173,http://127.0.0.1:5173";

export const config = {
  isProduction,
  host: process.env.HOST ?? (isProduction ? "127.0.0.1" : "0.0.0.0"),
  port: Number(process.env.PORT ?? process.env.API_PORT ?? "5008"),
  corsOrigins: (process.env.CORS_ORIGINS ?? defaultOrigins)
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  jsonLimit: process.env.JSON_BODY_LIMIT ?? "256kb",
  aiRateLimitWindowMs: Number(process.env.AI_RATE_LIMIT_WINDOW_MS ?? "900000"),
  aiRateLimitMax: Number(process.env.AI_RATE_LIMIT_MAX ?? "30"),
  generalRateLimitWindowMs: Number(
    process.env.GENERAL_RATE_LIMIT_WINDOW_MS ?? "900000",
  ),
  generalRateLimitMax: Number(process.env.GENERAL_RATE_LIMIT_MAX ?? "200"),
} as const;
