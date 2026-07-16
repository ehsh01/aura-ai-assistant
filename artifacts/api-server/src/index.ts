import app from "./app";
import { config } from "./lib/config";
import { logger } from "./lib/logger";
import { assertSecretEncryptionConfigured } from "./lib/secret-box";
import { startAttachmentTextBackfill } from "./services/attachment-text-extract";
import { startFinanceAutoSync } from "./services/finance-auto-sync";
import { startJobWorker } from "./services/job-worker";

/**
 * RECALL_ROLE splits responsibilities across PM2 processes:
 *  - "api" (default): serves HTTP. In production it sets
 *    RECALL_DISABLE_INLINE_WORKER=1 so background work runs only in the worker.
 *  - "worker": runs job queue + finance auto-sync + attachment backfill, no HTTP.
 * With neither env set (local dev / single process) the API also runs background
 * services inline, preserving prior behavior.
 */
const role = (process.env.RECALL_ROLE ?? "api").toLowerCase();

function startBackgroundServices(): void {
  startFinanceAutoSync();
  startAttachmentTextBackfill();
  startJobWorker();
}

assertSecretEncryptionConfigured(config.isProduction);

if (role === "worker") {
  startBackgroundServices();
  // All background timers are unref'd; hold the event loop open explicitly so
  // the worker process stays alive under PM2.
  setInterval(() => {}, 1 << 30);
  logger.info({ role }, "Recall worker started (background services, no HTTP listener)");
} else {
  if (!config.port || Number.isNaN(config.port) || config.port <= 0) {
    throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
  }

  app.listen(config.port, config.host, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port: config.port, host: config.host, role }, "Server listening");

    if (process.env.RECALL_DISABLE_INLINE_WORKER === "1") {
      logger.info("Inline background services disabled; handled by recall-worker process");
    } else {
      startBackgroundServices();
    }
  });
}
