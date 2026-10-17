import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@workspace/db/schema";

const migrationUrl = new URL(
  "../../../../lib/db/migrations/0015_jobs.sql",
  import.meta.url,
);
const USER_ID = "11111111-1111-4111-8111-111111111111";

let db: PGlite;
let pgliteDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("../lib/db", () => ({ getDb: () => pgliteDb }));

const {
  MAX_STALE_RECOVERIES,
  claimNextJob,
  failJob,
  recoverStaleProcessingJobs,
} = await import("./job-queue");

describe("stale job recovery", () => {
  beforeEach(async () => {
    db = new PGlite();
    pgliteDb = drizzle(db, { schema });
    await db.exec('CREATE TABLE "users" ("id" uuid PRIMARY KEY)');
    await db.exec(await readFile(migrationUrl, "utf8"));
    await db.exec(`INSERT INTO users (id) VALUES ('${USER_ID}')`);
  });

  afterEach(async () => {
    await db.close();
  });

  it("refunds an interrupted claim while a real failure keeps its attempt", async () => {
    await db.exec(`
      INSERT INTO jobs (
        id, user_id, type, payload, status, attempts, max_attempts,
        locked_at, locked_by
      ) VALUES (
        'stale-job', '${USER_ID}', 'connector_sync',
        '{"connectorId":"evernote","syncRunId":"sync-1"}'::jsonb,
        'processing', 1, 3, now() - interval '1 hour', 'dead-worker'
      )
    `);

    expect(await recoverStaleProcessingJobs()).toBe(1);
    const recovered = await db.query<{
      status: string;
      attempts: number;
      payload: { staleRecoveryCount?: number };
    }>(`
      SELECT status, attempts, payload
      FROM jobs
      WHERE id = 'stale-job'
    `);
    expect(recovered.rows[0]).toMatchObject({
      status: "queued",
      attempts: 0,
      payload: { staleRecoveryCount: 1 },
    });

    const claimed = await claimNextJob("replacement-worker");
    expect(claimed).toMatchObject({ id: "stale-job", attempts: 1 });
    expect(await failJob("stale-job", "real Evernote error")).toBe(false);
    const failedAttempt = await db.query<{
      status: string;
      attempts: number;
    }>(`
      SELECT status, attempts
      FROM jobs
      WHERE id = 'stale-job'
    `);
    expect(failedAttempt.rows[0]).toEqual({
      status: "queued",
      attempts: 1,
    });
  });

  it("stops re-queueing at the independent stale recovery cap", async () => {
    await db.exec(`
      INSERT INTO jobs (
        id, user_id, type, payload, status, attempts, max_attempts,
        locked_at, locked_by
      ) VALUES (
        'recovery-loop', '${USER_ID}', 'connector_sync',
        jsonb_build_object(
          'connectorId', 'evernote',
          'syncRunId', 'sync-2',
          'staleRecoveryCount', ${MAX_STALE_RECOVERIES - 1}
        ),
        'processing', 1, 3, now() - interval '1 hour', 'dead-worker'
      )
    `);

    expect(await recoverStaleProcessingJobs()).toBe(1);
    const result = await db.query<{
      status: string;
      attempts: number;
      recoveries: number;
    }>(`
      SELECT
        status,
        attempts,
        (payload->>'staleRecoveryCount')::int AS recoveries
      FROM jobs
      WHERE id = 'recovery-loop'
    `);
    expect(result.rows[0]).toEqual({
      status: "failed",
      attempts: 0,
      recoveries: MAX_STALE_RECOVERIES,
    });
  });
});
