import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../lib/db/migrations/0009_extension_tokens.sql",
  import.meta.url,
);

describe("extension token migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec('CREATE TABLE "users" ("id" uuid PRIMARY KEY)');
    await db.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("is idempotent and stores valid revocable token metadata", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    await expect(db.exec(migration)).resolves.toBeDefined();

    await db.exec(`
      INSERT INTO "users" ("id")
      VALUES ('11111111-1111-4111-8111-111111111111');

      INSERT INTO "extension_tokens" (
        "id", "user_id", "name", "token_hash", "scope",
        "created_at", "expires_at"
      ) VALUES (
        'ext-test',
        '11111111-1111-4111-8111-111111111111',
        'Test extension',
        '${"a".repeat(64)}',
        'capture:create',
        '2026-07-12T20:00:00Z',
        '2026-08-12T20:00:00Z'
      );
    `);

    await db.exec(`
      UPDATE "extension_tokens"
      SET "revoked_at" = '2026-07-13T20:00:00Z'
      WHERE "id" = 'ext-test';
    `);
    const result = await db.query<{ revoked: boolean }>(`
      SELECT "revoked_at" IS NOT NULL AS "revoked"
      FROM "extension_tokens"
      WHERE "id" = 'ext-test'
    `);
    expect(result.rows).toEqual([{ revoked: true }]);
  });

  it("enforces hash, scope, and expiration invariants", async () => {
    await db.exec(`
      INSERT INTO "users" ("id")
      VALUES ('22222222-2222-4222-8222-222222222222');
    `);

    const insert = (hash: string, scope: string, expiresAt: string) =>
      db.exec(`
        INSERT INTO "extension_tokens" (
          "id", "user_id", "token_hash", "scope", "created_at", "expires_at"
        ) VALUES (
          'ext-${Math.random().toString(36).slice(2)}',
          '22222222-2222-4222-8222-222222222222',
          '${hash}',
          '${scope}',
          '2026-07-12T20:00:00Z',
          '${expiresAt}'
        )
      `);

    await expect(
      insert("not-a-hash", "capture:create", "2026-08-12T20:00:00Z"),
    ).rejects.toThrow();
    await expect(
      insert("b".repeat(64), "account:read", "2026-08-12T20:00:00Z"),
    ).rejects.toThrow();
    await expect(
      insert("c".repeat(64), "capture:create", "2026-07-12T20:00:00Z"),
    ).rejects.toThrow();
  });
});
