#!/usr/bin/env node
/**
 * Migration runner for the shared DigitalOcean Postgres cluster.
 *
 * Replaces the hand-maintained migration list in deploy-recall-app.sh so a new
 * lib/db/migrations/*.sql file can never be silently skipped again.
 *
 * Behavior:
 *  - Ensures a `schema_migrations(filename, applied_at)` ledger exists.
 *  - Applies every migration file that isn't recorded yet, in filename order.
 *  - Each migration file already wraps itself in BEGIN/COMMIT, so we run the
 *    file as-is (no extra outer transaction) and then record it.
 *  - Baseline adoption: on an already-provisioned database with an empty ledger,
 *    existing files are recorded as applied WITHOUT being executed. Older
 *    migrations (e.g. 0016 CREATE TRIGGER) are not idempotent and must not be
 *    replayed against prod. The base schema (users/notes/tasks/...) is created by
 *    drizzle-kit push, not by these files, so a truly fresh DB must be pushed
 *    before running this.
 *  - pgvector migration is soft-fail (extension may be unavailable): warn and
 *    leave it unrecorded so it retries on a future deploy.
 *
 * Usage: DATABASE_URL=... node scripts/db-migrate.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Presence of this table means the DB is already provisioned (baseline case). */
export const CORE_TABLE = "public.notes";

/**
 * Core migration algorithm, decoupled from the pg driver so it can be exercised
 * against pglite (or any engine) in tests.
 *
 * @param {object} io
 * @param {(text: string, params?: unknown[]) => Promise<{ rows: any[] }>} io.query
 *   Runs a single (optionally parameterized) statement.
 * @param {(sql: string) => Promise<unknown>} io.execFile
 *   Runs a full multi-statement migration file.
 * @param {() => Promise<string[]>} io.listFiles  Returns sorted migration filenames.
 * @param {(filename: string) => Promise<string>} io.readMigration
 * @param {string} [io.coreTable]
 * @param {(msg: string) => void} [io.log]
 * @returns {Promise<{ applied: string[]; baselined: string[]; softFailed: string[] }>}
 */
export async function runMigrations(io) {
  const {
    query,
    execFile,
    listFiles,
    readMigration,
    coreTable = CORE_TABLE,
    log = (m) => console.log(`[db-migrate] ${m}`),
  } = io;

  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const appliedRes = await query("SELECT filename FROM schema_migrations");
  const applied = new Set(appliedRes.rows.map((r) => r.filename));

  const files = await listFiles();
  if (files.length === 0) {
    log("No migration files found; nothing to do.");
    return { applied: [], baselined: [], softFailed: [] };
  }

  const baselined = [];
  if (applied.size === 0) {
    const core = await query("SELECT to_regclass($1) AS reg", [coreTable]);
    const provisioned = core.rows[0]?.reg != null;
    if (provisioned) {
      log(
        `Existing database detected; baselining ${files.length} migration(s) as applied without executing.`,
      );
      for (const f of files) {
        await query(
          "INSERT INTO schema_migrations(filename) VALUES ($1) ON CONFLICT DO NOTHING",
          [f],
        );
        applied.add(f);
        baselined.push(f);
      }
    }
  }

  const appliedNow = [];
  const softFailed = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = await readMigration(f);
    log(`Applying ${f}`);
    try {
      await execFile(sql);
    } catch (err) {
      if (f.includes("pgvector")) {
        log(
          `WARN: ${f} failed (extension may be unavailable); continuing with jsonb embeddings`,
        );
        softFailed.push(f);
        continue;
      }
      throw new Error(`Migration failed on ${f}: ${err?.message ?? err}`);
    }
    await query(
      "INSERT INTO schema_migrations(filename) VALUES ($1) ON CONFLICT DO NOTHING",
      [f],
    );
    appliedNow.push(f);
  }

  log(
    appliedNow.length === 0
      ? "No new migrations to apply."
      : `Applied ${appliedNow.length} new migration(s).`,
  );
  return { applied: appliedNow, baselined, softFailed };
}

/** Default file source: lib/db/migrations relative to the current working dir. */
export function fileIo(migrationsDir = path.resolve(process.cwd(), "lib/db/migrations")) {
  return {
    listFiles: async () =>
      (await readdir(migrationsDir))
        .filter((f) => f.endsWith(".sql"))
        .sort((a, b) => a.localeCompare(b, "en")),
    readMigration: (f) => readFile(path.join(migrationsDir, f), "utf8"),
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[db-migrate] DATABASE_URL is required; refusing to run");
    process.exit(1);
  }

  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await runMigrations({
      query: (text, params) => client.query(text, params),
      // node-pg simple protocol runs a full multi-statement file; the file's own
      // trailing COMMIT/ROLLBACK closes its transaction even on error.
      execFile: (sql) => client.query(sql),
      ...fileIo(),
    });
  } finally {
    await client.end();
  }
}

// Only run the CLI when invoked directly (not when imported by a test).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[db-migrate] Unexpected error: ${err?.stack ?? err}`);
    process.exit(1);
  });
}
