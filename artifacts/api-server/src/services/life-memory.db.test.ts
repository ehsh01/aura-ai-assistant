import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../lib/db/migrations/0017_life_memory_lifecycle.sql",
  import.meta.url,
);

describe("life memory lifecycle migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE "users" ("id" uuid PRIMARY KEY);
      CREATE TABLE "life_memories" (
        "id" varchar(64) PRIMARY KEY,
        "user_id" uuid NOT NULL REFERENCES "users"("id"),
        "domain" varchar(32) NOT NULL DEFAULT 'other',
        "title" varchar(500) NOT NULL,
        "content" text NOT NULL DEFAULT '',
        "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "source_type" varchar(16) NOT NULL DEFAULT 'teach',
        "pinned" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("is idempotent and defaults existing rows to active", async () => {
    await expect(db.exec(await readFile(migrationUrl, "utf8"))).resolves.toBeDefined();

    await db.exec(`
      INSERT INTO "users" ("id")
      VALUES ('11111111-1111-4111-8111-111111111111');

      INSERT INTO "life_memories" ("id", "user_id", "title", "content")
      VALUES ('mem-1', '11111111-1111-4111-8111-111111111111', 'Address', '123 Main');
    `);

    const rows = await db.query<{ status: string }>(`
      SELECT status FROM life_memories WHERE id = 'mem-1'
    `);
    expect(rows.rows[0]?.status).toBe("active");

    await db.exec(`
      INSERT INTO "life_memories" (
        "id", "user_id", "title", "content", "status", "supersedes_id"
      ) VALUES (
        'mem-2',
        '11111111-1111-4111-8111-111111111111',
        'Address',
        '456 Oak',
        'active',
        'mem-1'
      );

      UPDATE life_memories SET status = 'superseded' WHERE id = 'mem-1';
    `);

    const active = await db.query<{ id: string }>(`
      SELECT id FROM life_memories WHERE status = 'active'
    `);
    expect(active.rows.map((r) => r.id)).toEqual(["mem-2"]);
  });
});
