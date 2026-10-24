import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const NIGHTLY_FINANCE_SKIPPED_EXIT_CODE = 75;

export type NightlyFinanceSyncSummary = {
  completed: number;
  skipped: number;
};

export function nightlyFinanceExitCode(
  summary: NightlyFinanceSyncSummary,
): number {
  return summary.skipped > 0 ? NIGHTLY_FINANCE_SKIPPED_EXIT_CODE : 0;
}

export function loadFinanceCliEnv(
  envPath = fileURLToPath(new URL("../.env", import.meta.url)),
): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).replace(/^export\s+/, "").trim();
    if (!key || process.env[key] != null) continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function connectorIdArg(argv: string[]): string | null {
  const index = argv.indexOf("--connector-id");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (index >= 0 && !value) {
    throw new Error("--connector-id requires a value");
  }
  return value?.trim() || process.env.FINANCE_CONNECTOR_ID?.trim() || null;
}

export async function runNightlyFinanceSync(
  requestedConnectorId?: string | null,
): Promise<NightlyFinanceSyncSummary> {
  loadFinanceCliEnv();
  requestedConnectorId ??= connectorIdArg(process.argv.slice(2));
  const [{ and, eq }, { connectors }, { getDb }, connectorService, watchdog] =
    await Promise.all([
      import("drizzle-orm"),
      import("@workspace/db/schema"),
      import("./lib/db"),
      import("./services/connectors"),
      import("./services/evernote-watchdog"),
    ]);
  const conditions = [
    eq(connectors.type, "finance_api"),
    eq(connectors.enabled, true),
  ];
  if (requestedConnectorId) {
    conditions.push(eq(connectors.id, requestedConnectorId));
  }
  const rows = await getDb()
    .select({ id: connectors.id, userId: connectors.userId })
    .from(connectors)
    .where(and(...conditions))
    .orderBy(connectors.updatedAt);

  if (requestedConnectorId && rows.length === 0) {
    throw new Error(`Enabled finance connector not found: ${requestedConnectorId}`);
  }

  let completed = 0;
  let skipped = 0;
  for (const row of rows) {
    await watchdog.assertEvernoteImportSafe();
    const outcome = await connectorService.syncConnectorForUser(
      row.userId,
      row.id,
    );
    if (outcome.skipped) {
      skipped += 1;
      console.error(
        JSON.stringify({
          status: "skipped",
          reason: outcome.skipReason ?? "finance_sync_overlap",
          connectorId: row.id,
          syncRunId: outcome.syncRunId,
        }),
      );
      continue;
    }
    completed += 1;
    console.log(
      JSON.stringify({
        status: "completed",
        connectorId: row.id,
        syncRunId: outcome.syncRunId,
        result: outcome.result,
      }),
    );
  }
  return { completed, skipped };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const isMain = invokedPath === fileURLToPath(import.meta.url);

if (isMain) {
  runNightlyFinanceSync()
    .then((summary) => {
      console.log(JSON.stringify(summary));
      process.exitCode = nightlyFinanceExitCode(summary);
    })
    .catch((error) => {
      console.error(
        error instanceof Error ? error.message : "Nightly finance sync failed",
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      const { closeDb } = await import("./lib/db");
      await closeDb();
    });
}
