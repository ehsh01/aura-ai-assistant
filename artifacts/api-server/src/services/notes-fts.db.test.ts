import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hostnameIlikePatterns } from "./notes";

const migrationUrl = new URL("../../../../lib/db/migrations/0016_notes_fts.sql", import.meta.url);

describe("notes FTS migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE "users" ("id" uuid PRIMARY KEY);
      CREATE TABLE "notes" (
        "id" varchar(64) PRIMARY KEY,
        "user_id" uuid NOT NULL REFERENCES "users"("id"),
        "title" varchar(500) NOT NULL DEFAULT 'Untitled',
        "content" text NOT NULL DEFAULT '',
        "preview" text NOT NULL DEFAULT '',
        "tags" jsonb NOT NULL DEFAULT '[]'::jsonb
      );
      CREATE TABLE "note_attachments" (
        "id" varchar(128) PRIMARY KEY,
        "note_id" varchar(64) NOT NULL REFERENCES "notes"("id") ON DELETE CASCADE,
        "file_name" varchar(500) NOT NULL DEFAULT 'attachment',
        "extracted_text" text
      );
    `);
    await db.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("is idempotent and ranks OCR attachment text via FTS", async () => {
    await expect(db.exec(await readFile(migrationUrl, "utf8"))).resolves.toBeDefined();

    await db.exec(`
      INSERT INTO "users" ("id")
      VALUES ('11111111-1111-4111-8111-111111111111');

      INSERT INTO "notes" ("id", "user_id", "title", "content", "preview", "tags")
      VALUES
        ('note-old', '11111111-1111-4111-8111-111111111111', 'Groceries', 'milk eggs', 'milk', '[]'::jsonb),
        ('note-vin', '11111111-1111-4111-8111-111111111111', 'Porsche paperwork', 'Vehicle records', 'Vehicle', '["car"]'::jsonb);
    `);

    await db.exec(`
      INSERT INTO "note_attachments" ("id", "note_id", "file_name", "extracted_text")
      VALUES ('att-1', 'note-vin', 'scan.jpg', 'VIN WP0ZZZ99ZTS392124');
    `);

    const hit = await db.query<{ id: string }>(`
      SELECT id
      FROM notes
      WHERE search_tsv @@ to_tsquery('simple', 'wp0zzz99zts392124:*')
      ORDER BY ts_rank_cd(search_tsv, to_tsquery('simple', 'wp0zzz99zts392124:*')) DESC
    `);
    expect(hit.rows.map((r) => r.id)).toEqual(["note-vin"]);

    const miss = await db.query<{ id: string }>(`
      SELECT id FROM notes
      WHERE search_tsv @@ to_tsquery('simple', 'bananas:*')
    `);
    expect(miss.rows).toEqual([]);
  });

  it("finds hostname tokens at query time without a reindex or migration", async () => {
    await db.exec(`
      INSERT INTO "users" ("id")
      VALUES ('11111111-1111-4111-8111-111111111111');

      INSERT INTO "notes" ("id", "user_id", "title", "content", "preview", "tags")
      VALUES
        (
          'note-en-xfbhdx',
          '11111111-1111-4111-8111-111111111111',
          'Turn an image into a link',
          'psychiatry.med.miami.edu',
          '',
          '[]'::jsonb
        ),
        (
          'note-khaila',
          '11111111-1111-4111-8111-111111111111',
          'School portal',
          'khaila.schoolportal.com',
          '',
          '[]'::jsonb
        );

      INSERT INTO "notes" (
        "id",
        "user_id",
        "title",
        "content",
        "preview",
        "tags"
      )
      SELECT
        'psychiatry-decoy-' || g,
        '11111111-1111-4111-8111-111111111111',
        'Psychiatry titled note ' || g,
        'No website hostname here',
        '',
        '[]'::jsonb
      FROM generate_series(1, 60) g;
    `);

    for (const [term, expectedId] of [
      ["psychiatry", "note-en-xfbhdx"],
      ["khaila", "note-khaila"],
    ] as const) {
      const patterns = hostnameIlikePatterns(term);
      const expandedHit = await db.query<{ id: string }>(
        `SELECT id
         FROM notes
         WHERE search_document ILIKE $1
            OR search_document ILIKE $2
            OR search_document ILIKE $3
            OR search_document ILIKE $4`,
        patterns,
      );
      expect(expandedHit.rows.map((row) => row.id)).toContain(expectedId);
    }

    const patterns = hostnameIlikePatterns("psychiatry");
    const pinned = await db.query<{ id: string }>(
      `SELECT id
       FROM notes
       WHERE search_tsv @@ to_tsquery('simple', 'psychiatry:*')
          OR search_document ILIKE $1
          OR search_document ILIKE $2
          OR search_document ILIKE $3
          OR search_document ILIKE $4
       ORDER BY CASE
         WHEN search_document ILIKE $1
           OR search_document ILIKE $2
           OR search_document ILIKE $3
           OR search_document ILIKE $4
         THEN 1 ELSE 0 END DESC
       LIMIT 50`,
      patterns,
    );
    expect(pinned.rows[0]?.id).toBe("note-en-xfbhdx");
  });
});
