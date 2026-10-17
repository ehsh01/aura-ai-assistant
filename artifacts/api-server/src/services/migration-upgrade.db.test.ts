import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
// The production runner is plain JavaScript and intentionally has no TS surface.
// @ts-expect-error importing the migration runner verifies the deployed algorithm
import { runMigrations } from "../../../../scripts/db-migrate.mjs";

const CURRENT_MIGRATIONS = [
  "0034_attachment_ai_ocr.sql",
  "0035_ai_result_cache.sql",
  "0036_evernote_source_search.sql",
] as const;

const migrationUrls = new Map<string, URL>(
  CURRENT_MIGRATIONS.map((filename) => [
    filename,
    new URL(`../../../../lib/db/migrations/${filename}`, import.meta.url),
  ]),
);
const historicalEvernoteMigration = new URL(
  "./fixtures/0034_evernote_source_search.sql",
  import.meta.url,
);

async function createPreMigrationSchema(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE users (
      id uuid PRIMARY KEY
    );
    CREATE TABLE note_attachments (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_hash varchar(64)
    );
    CREATE TABLE sync_runs (
      id varchar(64) PRIMARY KEY,
      records_fetched integer NOT NULL DEFAULT 0,
      records_created integer NOT NULL DEFAULT 0,
      records_updated integer NOT NULL DEFAULT 0,
      records_failed integer NOT NULL DEFAULT 0
    );
    CREATE TABLE source_records (
      id varchar(64) PRIMARY KEY,
      record_title varchar(500),
      record_text text,
      record_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    INSERT INTO users (id) VALUES ('11111111-1111-4111-8111-111111111111');
    INSERT INTO note_attachments (id, user_id, content_hash)
    VALUES (
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      'hash-1'
    );
    INSERT INTO source_records (id, record_title, record_text, record_metadata)
    VALUES (
      'source-1',
      'Roof permit',
      'Inspector approved the revised drawings',
      '{"notebookName":"Construction","tagNames":["permit"],"contentHash":"same"}'
    );
  `);
}

async function runCurrentMigrations(db: PGlite) {
  return runMigrations({
    query: (text: string, params?: unknown[]) => db.query(text, params),
    execFile: (sql: string) => db.exec(sql),
    listFiles: async () => [...CURRENT_MIGRATIONS],
    readMigration: async (filename: string) => {
      const url = migrationUrls.get(filename);
      if (!url) throw new Error(`Unexpected migration ${filename}`);
      return readFile(url, "utf8");
    },
    coreTable: "public.__fresh_database_marker__",
    log: () => undefined,
  });
}

async function expectCurrentSchema(db: PGlite): Promise<void> {
  const attachmentColumns = await db.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'note_attachments'
      AND column_name = 'ai_ocr_at'
  `);
  expect(attachmentColumns.rows).toHaveLength(1);

  const cacheTable = await db.query<{ name: string | null }>(`
    SELECT to_regclass('public.ai_result_cache')::text AS name
  `);
  expect(cacheTable.rows[0]?.name).toBe("ai_result_cache");

  const source = await db.query<{
    record_title: string;
    record_text: string;
    search_document: string;
  }>(`
    SELECT
      source_records.record_title,
      source_records.record_text,
      source_records.search_document
    FROM source_records
    WHERE source_records.id = 'source-1'
  `);
  expect(source.rows[0]).toMatchObject({
    record_title: "Roof permit",
    record_text: "Inspector approved the revised drawings",
  });
  expect(source.rows[0]?.search_document).toContain("Construction");

  const syncColumns = await db.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'sync_runs'
      AND column_name = 'records_skipped'
  `);
  expect(syncColumns.rows).toHaveLength(1);

  const triggers = await db.query<{ count: number }>(`
    SELECT count(*)::integer AS count
    FROM pg_trigger
    WHERE tgname = 'source_records_search_refresh'
      AND NOT tgisinternal
  `);
  expect(triggers.rows[0]?.count).toBe(1);
}

describe("current migration upgrade path", () => {
  let db: PGlite | null = null;

  afterEach(async () => {
    await db?.close();
    db = null;
  });

  it("applies 0034, 0035, and 0036 on a fresh pre-migration schema", async () => {
    db = new PGlite();
    await createPreMigrationSchema(db);

    const first = await runCurrentMigrations(db);
    expect(first.applied).toEqual([...CURRENT_MIGRATIONS]);
    await expectCurrentSchema(db);

    const second = await runCurrentMigrations(db);
    expect(second.applied).toEqual([]);
  });

  it("safely replays renamed 0036 after production applied old Evernote 0034", async () => {
    db = new PGlite();
    await createPreMigrationSchema(db);
    await db.exec(await readFile(historicalEvernoteMigration, "utf8"));
    await db.exec(`
      CREATE TABLE schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO schema_migrations (filename)
      VALUES ('0034_evernote_source_search.sql');
      INSERT INTO sync_runs (id, records_skipped)
      VALUES ('production-sync', 7);
    `);

    const result = await runCurrentMigrations(db);
    expect(result.applied).toEqual([...CURRENT_MIGRATIONS]);
    await expectCurrentSchema(db);

    const ledger = await db.query<{ filename: string }>(`
      SELECT filename FROM schema_migrations ORDER BY filename
    `);
    expect(ledger.rows.map((row) => row.filename)).toEqual([
      "0034_attachment_ai_ocr.sql",
      "0034_evernote_source_search.sql",
      "0035_ai_result_cache.sql",
      "0036_evernote_source_search.sql",
    ]);
    const historicalData = await db.query<{ records_skipped: number }>(`
      SELECT records_skipped
      FROM sync_runs
      WHERE id = 'production-sync'
    `);
    expect(historicalData.rows[0]?.records_skipped).toBe(7);

    const rerun = await runCurrentMigrations(db);
    expect(rerun.applied).toEqual([]);
  });
});
