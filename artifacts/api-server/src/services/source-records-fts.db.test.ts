import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../lib/db/migrations/0034_evernote_source_search.sql",
  import.meta.url,
);

describe("Evernote source-record search migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE "sync_runs" (
        "id" varchar(64) PRIMARY KEY,
        "records_fetched" integer NOT NULL DEFAULT 0,
        "records_created" integer NOT NULL DEFAULT 0,
        "records_updated" integer NOT NULL DEFAULT 0,
        "records_failed" integer NOT NULL DEFAULT 0
      );
      CREATE TABLE "source_records" (
        "id" varchar(64) PRIMARY KEY,
        "record_title" varchar(500),
        "record_text" text,
        "record_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
      );
    `);
    await db.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("is idempotent and indexes Evernote body, notebook, and tags", async () => {
    await expect(
      db.exec(await readFile(migrationUrl, "utf8")),
    ).resolves.toBeDefined();

    await db.exec(`
      INSERT INTO "sync_runs" ("id", "records_skipped")
      VALUES ('sync-1', 7);

      INSERT INTO "source_records" (
        "id",
        "record_title",
        "record_text",
        "record_metadata"
      ) VALUES (
        'sr-1',
        'Roof permit',
        'Inspector approved the revised drawings',
        '{"notebookName":"Construction","tags":["Miami","permit"],"contentHash":"same"}'::jsonb
      );
    `);

    const bodyHit = await db.query<{ id: string }>(`
      SELECT id FROM source_records
      WHERE search_tsv @@ to_tsquery('simple', 'inspector:*')
    `);
    expect(bodyHit.rows.map((row) => row.id)).toEqual(["sr-1"]);

    const metadataHit = await db.query<{ id: string }>(`
      SELECT id FROM source_records
      WHERE search_tsv @@ to_tsquery('simple', 'construction:* & miami:*')
    `);
    expect(metadataHit.rows.map((row) => row.id)).toEqual(["sr-1"]);

    const before = await db.query<{ search_tsv: string }>(`
      SELECT search_tsv::text AS search_tsv
      FROM source_records WHERE id = 'sr-1'
    `);
    await db.exec(`
      UPDATE source_records
      SET record_metadata = record_metadata || '{"updateSequenceNum":12}'::jsonb
      WHERE id = 'sr-1'
    `);
    const after = await db.query<{ search_tsv: string }>(`
      SELECT search_tsv::text AS search_tsv
      FROM source_records WHERE id = 'sr-1'
    `);
    expect(after.rows[0]?.search_tsv).toBe(before.rows[0]?.search_tsv);

    const sync = await db.query<{ records_skipped: number }>(`
      SELECT records_skipped FROM sync_runs WHERE id = 'sync-1'
    `);
    expect(sync.rows[0]?.records_skipped).toBe(7);
  });
});
