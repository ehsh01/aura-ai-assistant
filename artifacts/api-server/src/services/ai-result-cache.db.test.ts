import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../lib/db/migrations/0035_ai_result_cache.sql",
  import.meta.url,
);

describe("0035 AI result cache migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec('CREATE TABLE "users" ("id" uuid PRIMARY KEY)');
    await db.exec(
      `INSERT INTO users (id) VALUES ('11111111-1111-4111-8111-111111111111')`,
    );
    await db.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("is idempotent and permits only one row per user/feature/input hash", async () => {
    await expect(
      db.exec(await readFile(migrationUrl, "utf8")),
    ).resolves.toBeDefined();
    await db.exec(`
      INSERT INTO ai_result_cache (user_id, feature, input_hash, result)
      VALUES (
        '11111111-1111-4111-8111-111111111111',
        'home_digest',
        'same-hash',
        '{"digest":"fallback"}'::jsonb
      )
    `);
    await expect(
      db.exec(`
        INSERT INTO ai_result_cache (user_id, feature, input_hash, result)
        VALUES (
          '11111111-1111-4111-8111-111111111111',
          'home_digest',
          'same-hash',
          '{"digest":"duplicate"}'::jsonb
        )
      `),
    ).rejects.toThrow();
  });
});
