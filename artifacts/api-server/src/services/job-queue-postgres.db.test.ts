import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const postgresUrl = process.env.RECALL_TEST_POSTGRES_URL?.trim();
const describeWithPostgres = postgresUrl ? describe : describe.skip;
const USER_ID = "22222222-2222-4222-8222-222222222222";

describeWithPostgres("connector job guards on PostgreSQL", () => {
  const schemaName = `job_guard_${randomUUID().replaceAll("-", "")}`;
  let admin: pg.Pool;
  let closeDb: typeof import("../lib/db").closeDb;
  let claimJobById: typeof import("./job-queue").claimJobById;
  let claimNextJob: typeof import("./job-queue").claimNextJob;
  let dropStaleQueuedFinanceJobs: typeof import("./job-queue").dropStaleQueuedFinanceJobs;
  let previousDatabaseUrl: string | undefined;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: postgresUrl });
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`
      CREATE TABLE "${schemaName}".users (
        id uuid PRIMARY KEY
      );
      CREATE TABLE "${schemaName}".connectors (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES "${schemaName}".users(id),
        sync_status varchar(32) NOT NULL DEFAULT 'syncing',
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE "${schemaName}".sync_runs (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES "${schemaName}".users(id),
        connector_id varchar(64) NOT NULL REFERENCES "${schemaName}".connectors(id),
        status varchar(32) NOT NULL DEFAULT 'queued',
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
      CREATE TABLE "${schemaName}".jobs (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES "${schemaName}".users(id),
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
      INSERT INTO "${schemaName}".users (id) VALUES ('${USER_ID}');
      INSERT INTO "${schemaName}".connectors (id, user_id)
      VALUES
        ('finance', '${USER_ID}'),
        ('evernote', '${USER_ID}');
      INSERT INTO "${schemaName}".sync_runs (
        id, user_id, connector_id, status, started_at
      ) VALUES (
        'old-finance', '${USER_ID}', 'finance', 'queued',
        now() - interval '2 hours'
      );
      INSERT INTO "${schemaName}".jobs (
        id, user_id, type, payload, status, available_at, created_at, updated_at
      ) VALUES
        (
          'old-finance', '${USER_ID}', 'connector_sync',
          '{"connectorId":"finance","syncRunId":"old-finance","connectorType":"finance_api"}',
          'queued', now() - interval '2 hours',
          now() - interval '2 hours', now() - interval '2 hours'
        ),
        (
          'old-evernote-next', '${USER_ID}', 'connector_sync',
          '{"connectorId":"evernote","syncRunId":"old-evernote-next"}',
          'queued', now() - interval '2 hours',
          now() - interval '2 hours', now() - interval '2 hours'
        ),
        (
          'old-evernote-explicit', '${USER_ID}', 'connector_sync',
          '{"connectorId":"evernote","syncRunId":"old-evernote-explicit"}',
          'queued', now() - interval '90 minutes',
          now() - interval '90 minutes', now() - interval '90 minutes'
        );
    `);

    const scopedUrl = new URL(postgresUrl!);
    scopedUrl.searchParams.set("options", `-c search_path=${schemaName}`);
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = scopedUrl.toString();
    ({ closeDb } = await import("../lib/db"));
    ({
      claimJobById,
      claimNextJob,
      dropStaleQueuedFinanceJobs,
    } = await import("./job-queue"));
  });

  afterAll(async () => {
    await closeDb?.();
    if (previousDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await admin?.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin?.end();
  });

  it("drops old finance while old Evernote remains claimable on both claim paths", async () => {
    await expect(dropStaleQueuedFinanceJobs()).resolves.toBe(1);
    await expect(claimNextJob("next-worker")).resolves.toMatchObject({
      id: "old-evernote-next",
      status: "processing",
    });
    await expect(
      claimJobById("explicit-worker", "old-evernote-explicit"),
    ).resolves.toMatchObject({
      id: "old-evernote-explicit",
      status: "processing",
    });

    const statuses = await admin.query<{
      id: string;
      status: string;
    }>(`
      SELECT id, status
      FROM "${schemaName}".jobs
      ORDER BY id
    `);
    expect(statuses.rows).toEqual([
      { id: "old-evernote-explicit", status: "processing" },
      { id: "old-evernote-next", status: "processing" },
      { id: "old-finance", status: "failed" },
    ]);
  });
});
