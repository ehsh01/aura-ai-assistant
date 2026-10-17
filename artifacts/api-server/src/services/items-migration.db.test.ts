import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../lib/db/migrations/0037_saved_items.sql",
  import.meta.url,
);

describe("saved items migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE captures (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id)
      );
    `);
    await db.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("is idempotent and indexes item title, content, tags, and notebook", async () => {
    await expect(db.exec(await readFile(migrationUrl, "utf8"))).resolves.toBeDefined();
    await db.exec(`
      INSERT INTO users (id) VALUES ('11111111-1111-4111-8111-111111111111');
      INSERT INTO items (
        id, user_id, kind, title, body_text, tags, notebook
      ) VALUES (
        'item-1',
        '11111111-1111-4111-8111-111111111111',
        'note',
        'Kitchen remodel',
        'Permit revision approved',
        '["contractor"]'::jsonb,
        'House Projects'
      );
    `);
    const result = await db.query<{ id: string }>(`
      SELECT id
      FROM items
      WHERE search_tsv @@ websearch_to_tsquery('simple', 'permit contractor')
    `);
    expect(result.rows).toEqual([{ id: "item-1" }]);
  });
});
