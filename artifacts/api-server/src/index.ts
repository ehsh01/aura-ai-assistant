import app from "./app";
import { config } from "./lib/config";
import { logger } from "./lib/logger";
import { assertSecretEncryptionConfigured } from "./lib/secret-box";
import { startAttachmentTextBackfill } from "./services/attachment-text-extract";
import { startFinanceAutoSync } from "./services/finance-auto-sync";

if (!config.port || Number.isNaN(config.port) || config.port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}
assertSecretEncryptionConfigured(config.isProduction);

app.listen(config.port, config.host, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port: config.port, host: config.host }, "Server listening");
  startFinanceAutoSync();
  startAttachmentTextBackfill();
});
