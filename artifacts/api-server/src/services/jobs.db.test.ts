import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL("../../../../lib/db/migrations/0015_jobs.sql", import.meta.url);

describe("jobs migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec('CREATE TABLE "users" ("id" uuid PRIMARY KEY)');
    await db.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("is idempotent and supports SKIP LOCKED claim", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    await expect(db.exec(migration)).resolves.toBeDefined();

    await db.exec(`
      INSERT INTO "users" ("id")
      VALUES ('11111111-1111-4111-8111-111111111111');

      INSERT INTO "jobs" (
        "id", "user_id", "type", "payload", "status", "attempts", "max_attempts"
      ) VALUES (
        'job-1',
        '11111111-1111-4111-8111-111111111111',
        'capture_extraction',
        '{"captureId":"cap-1"}'::jsonb,
        'queued',
        0,
        3
      );
    `);

    const claimed = await db.query<{ id: string; status: string; attempts: number }>(`
      UPDATE jobs
      SET
        status = 'processing',
        locked_at = now(),
        locked_by = 'test-worker',
        started_at = COALESCE(started_at, now()),
        attempts = attempts + 1,
        updated_at = now()
      WHERE id = (
        SELECT id
        FROM jobs
        WHERE status = 'queued'
          AND available_at <= now()
        ORDER BY available_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, status, attempts
    `);

    expect(claimed.rows).toEqual([
      { id: "job-1", status: "processing", attempts: 1 },
    ]);

    const empty = await db.query(`
      UPDATE jobs
      SET status = 'processing'
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'queued'
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id
    `);
    expect(empty.rows).toEqual([]);
  });
});
