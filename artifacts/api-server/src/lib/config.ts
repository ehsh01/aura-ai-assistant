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
  jsonLimit: process.env.JSON_BODY_LIMIT ?? "25mb",
  /** Max assembled ENEX size (bytes). Default 4GB. */
  uploadMaxBytes: Number(
    process.env.UPLOAD_MAX_BYTES ?? String(4 * 1024 * 1024 * 1024),
  ),
  uploadDir: process.env.UPLOAD_DIR ?? "/var/www/recall-app/data/enex-uploads",
  attachmentsDir: process.env.ATTACHMENTS_DIR ?? "/var/www/recall-app/data/attachments",
  /** Max single attachment extracted from ENEX (bytes). Default 25MB. */
  attachmentMaxBytes: Number(
    process.env.ATTACHMENT_MAX_BYTES ?? String(25 * 1024 * 1024),
  ),
  uploadChunkMaxBytes: Number(
    process.env.UPLOAD_CHUNK_MAX_BYTES ?? String(50 * 1024 * 1024),
  ),
  aiRateLimitWindowMs: Number(process.env.AI_RATE_LIMIT_WINDOW_MS ?? "900000"),
  aiRateLimitMax: Number(process.env.AI_RATE_LIMIT_MAX ?? "30"),
  generalRateLimitWindowMs: Number(
    process.env.GENERAL_RATE_LIMIT_WINDOW_MS ?? "900000",
  ),
  generalRateLimitMax: Number(process.env.GENERAL_RATE_LIMIT_MAX ?? "200"),
} as const;
