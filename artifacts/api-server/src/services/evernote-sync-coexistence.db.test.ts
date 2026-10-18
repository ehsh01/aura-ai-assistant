import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@workspace/db/schema";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTOR_ID = "evernote-sanitized";

let db: PGlite;
let pgliteDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("../lib/db", () => ({
  DatabaseAdvisoryLockBusyError: class extends Error {},
  getDb: () => pgliteDb,
  withDbAdvisoryLock: async <T>(
    _key: string,
    callback: () => Promise<T>,
  ): Promise<T> => callback(),
}));

const { enqueueEvernoteSyncForUser } = await import("./connectors");
const { recoverStaleProcessingJobs } = await import("./job-queue");

describe("Evernote incremental/backfill coexistence", () => {
  beforeEach(async () => {
    db = new PGlite();
    pgliteDb = drizzle(db, { schema });
    await db.exec(`
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE connectors (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        name varchar(255) NOT NULL,
        type varchar(32) NOT NULL,
        description text,
        base_url text,
        auth_type varchar(32),
        enabled boolean NOT NULL DEFAULT true,
        last_sync_at timestamptz,
        sync_status varchar(32) NOT NULL DEFAULT 'disconnected',
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE sync_runs (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        connector_id varchar(64) NOT NULL REFERENCES connectors(id),
        status varchar(32) NOT NULL DEFAULT 'running',
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        records_fetched integer NOT NULL DEFAULT 0,
        records_created integer NOT NULL DEFAULT 0,
        records_updated integer NOT NULL DEFAULT 0,
        records_skipped integer NOT NULL DEFAULT 0,
        records_failed integer NOT NULL DEFAULT 0,
        error_message text,
        source_errors jsonb NOT NULL DEFAULT '{}'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE jobs (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        type varchar(64) NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        status varchar(32) NOT NULL DEFAULT 'queued',
        attempts integer NOT NULL DEFAULT 0,
        max_attempts integer NOT NULL DEFAULT 3,
        last_error text,
        available_at timestamptz NOT NULL DEFAULT now(),
        locked_at timestamptz,
        locked_by varchar(128),
        started_at timestamptz,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO users (id) VALUES ('${USER_ID}');
      INSERT INTO connectors (id, user_id, name, type, enabled)
      VALUES ('${CONNECTOR_ID}', '${USER_ID}', 'Evernote', 'evernote', true);
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  it("queues one incremental run beside the durable backfill and resumes both after restart", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL(
          "./fixtures/evernote-incremental-overlap.sanitized.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      fullRun: {
        id: string;
        status: string;
        recordsFetched: number;
        metadata: Record<string, unknown>;
      };
    };
    await pgliteDb.insert(schema.syncRuns).values({
      id: fixture.fullRun.id,
      userId: USER_ID,
      connectorId: CONNECTOR_ID,
      status: fixture.fullRun.status,
      recordsFetched: fixture.fullRun.recordsFetched,
      metadata: fixture.fullRun.metadata,
    });
    await pgliteDb.insert(schema.jobs).values({
      id: fixture.fullRun.id,
      userId: USER_ID,
      type: "connector_sync",
      payload: {
        connectorId: CONNECTOR_ID,
        syncRunId: fixture.fullRun.id,
      },
      status: "processing",
      attempts: 1,
      lockedAt: new Date(Date.now() - 60 * 60_000),
      lockedBy: "stopped-worker",
    });

    const incremental = await enqueueEvernoteSyncForUser(
      USER_ID,
      CONNECTOR_ID,
      "incremental",
      { scheduled: true },
    );
    expect(incremental.syncRunId).not.toBe(fixture.fullRun.id);
    expect(
      await enqueueEvernoteSyncForUser(USER_ID, CONNECTOR_ID, "incremental", {
        scheduled: true,
      }),
    ).toMatchObject({
      syncRunId: incremental.syncRunId,
      status: "queued",
    });

    await db.exec(`
      UPDATE sync_runs SET status = 'running'
      WHERE id = '${incremental.syncRunId}';
      UPDATE jobs
      SET status = 'processing',
          attempts = 1,
          locked_at = now() - interval '1 hour',
          locked_by = 'stopped-worker'
      WHERE id = '${incremental.jobId}';
    `);
    expect(await recoverStaleProcessingJobs()).toBe(2);

    const runs = await db.query<{
      id: string;
      status: string;
      phase: string;
      start_index: number | null;
    }>(`
      SELECT
        id,
        status,
        metadata->>'evernotePhase' AS phase,
        (metadata->'evernoteCheckpoint'->>'startIndex')::int AS start_index
      FROM sync_runs
      ORDER BY id
    `);
    expect(runs.rows).toEqual(
      expect.arrayContaining([
        {
          id: fixture.fullRun.id,
          status: "running",
          phase: "attachments",
          start_index: 4927,
        },
        {
          id: incremental.syncRunId,
          status: "running",
          phase: "notes",
          start_index: 0,
        },
      ]),
    );
    const jobs = await db.query<{
      id: string;
      status: string;
      attempts: number;
      recoveries: number;
    }>(`
      SELECT
        id,
        status,
        attempts,
        (payload->>'staleRecoveryCount')::int AS recoveries
      FROM jobs
      ORDER BY id
    `);
    expect(jobs.rows).toHaveLength(2);
    expect(jobs.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.fullRun.id,
          status: "queued",
          attempts: 0,
          recoveries: 1,
        }),
        expect.objectContaining({
          id: incremental.jobId,
          status: "queued",
          attempts: 0,
          recoveries: 1,
        }),
      ]),
    );
  });
});
