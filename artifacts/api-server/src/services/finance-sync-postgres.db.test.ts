import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const postgresUrl = process.env.RECALL_TEST_POSTGRES_URL?.trim();
const describeWithPostgres = postgresUrl ? describe : describe.skip;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTOR_ID = "finance-savepoint-test";
const ROLLBACK_CONNECTOR_ID = "finance-rollback-test";

describeWithPostgres("finance sync PostgreSQL savepoints", () => {
  const schemaName = `finance_sync_${randomUUID().replaceAll("-", "")}`;
  let admin: pg.Pool;
  let syncConnectorForUser: typeof import("./connectors").syncConnectorForUser;
  let closeDb: typeof import("../lib/db").closeDb;
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
        name varchar(255) NOT NULL,
        type varchar(32) NOT NULL,
        description text,
        base_url text,
        auth_type varchar(32),
        enabled boolean NOT NULL DEFAULT true,
        last_sync_at timestamptz,
        sync_status varchar(32) NOT NULL DEFAULT 'connected',
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE "${schemaName}".sync_runs (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES "${schemaName}".users(id),
        connector_id varchar(64) NOT NULL REFERENCES "${schemaName}".connectors(id),
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
      CREATE TABLE "${schemaName}".source_records (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES "${schemaName}".users(id),
        connector_id varchar(64) NOT NULL REFERENCES "${schemaName}".connectors(id),
        external_id varchar(255) NOT NULL,
        record_type varchar(32) NOT NULL,
        record_title varchar(500),
        record_text text,
        record_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        source_url text,
        source_created_at timestamptz,
        source_updated_at timestamptz,
        last_synced_at timestamptz,
        search_document text NOT NULL DEFAULT '',
        search_tsv tsvector,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (connector_id, external_id)
      );
      CREATE TABLE "${schemaName}".evidence (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES "${schemaName}".users(id),
        entity_type varchar(32) NOT NULL,
        entity_id varchar(64) NOT NULL,
        claim_type varchar(64) NOT NULL,
        source_capture_id varchar(64),
        source_record_id varchar(64),
        evidence_text text,
        evidence_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        file_name varchar(500),
        file_id varchar(64),
        row_number integer,
        page_number integer,
        url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX evidence_user_source_claim_idx
        ON "${schemaName}".evidence
        (user_id, source_record_id, claim_type, updated_at DESC);
      CREATE TABLE "${schemaName}".audit_log (
        id varchar(64) PRIMARY KEY,
        user_id uuid REFERENCES "${schemaName}".users(id),
        action varchar(64) NOT NULL,
        entity_type varchar(32),
        entity_id varchar(64),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO "${schemaName}".users (id) VALUES ('${USER_ID}');
      INSERT INTO "${schemaName}".connectors (
        id, user_id, name, type, enabled, sync_status
      ) VALUES (
        '${CONNECTOR_ID}', '${USER_ID}', 'Finance', 'finance_api', true, 'connected'
      );
    `);

    const scopedUrl = new URL(postgresUrl!);
    scopedUrl.searchParams.set("options", `-c search_path=${schemaName}`);
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = scopedUrl.toString();
    ({ syncConnectorForUser } = await import("./connectors"));
    ({ closeDb } = await import("../lib/db"));
  });

  afterAll(async () => {
    await closeDb?.();
    if (previousDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await admin?.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin?.end();
  });

  it("commits good records around one bad record and reports partial success", async () => {
    const result = await syncConnectorForUser(
      USER_ID,
      CONNECTOR_ID,
      {
        records: [
          { id: "good-1", date: "2026-10-20", amount: -10, payee: "One" },
          {
            id: "x".repeat(300),
            date: "2026-10-21",
            amount: -20,
            payee: "Invalid",
          },
          { id: "good-2", date: "2026-10-22", amount: -30, payee: "Two" },
        ],
      },
    );

    expect(result.result).toMatchObject({
      recordsFetched: 3,
      recordsCreated: 2,
      recordsFailed: 1,
    });
    const records = await admin.query<{
      external_id: string;
    }>(`
      SELECT external_id
      FROM "${schemaName}".source_records
      ORDER BY external_id
    `);
    expect(records.rows).toEqual([
      { external_id: "good-1" },
      { external_id: "good-2" },
    ]);
    const evidence = await admin.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM "${schemaName}".evidence
    `);
    expect(evidence.rows[0]?.count).toBe(2);
    const run = await admin.query<{
      status: string;
      records_created: number;
      records_failed: number;
    }>(`
      SELECT status, records_created, records_failed
      FROM "${schemaName}".sync_runs
      WHERE id = '${result.syncRunId}'
    `);
    expect(run.rows[0]).toEqual({
      status: "partial_success",
      records_created: 2,
      records_failed: 1,
    });
    const connector = await admin.query<{
      sync_status: string;
      has_last_sync: boolean;
    }>(`
      SELECT sync_status, last_sync_at IS NOT NULL AS has_last_sync
      FROM "${schemaName}".connectors
      WHERE id = '${CONNECTOR_ID}'
    `);
    expect(connector.rows[0]).toEqual({
      sync_status: "partial_success",
      has_last_sync: true,
    });
  });

  it("does not publish counters or last-sync when the outer transaction rolls back", async () => {
    await admin.query(`
      INSERT INTO "${schemaName}".connectors (
        id, user_id, name, type, enabled, sync_status
      ) VALUES (
        '${ROLLBACK_CONNECTOR_ID}', '${USER_ID}', 'Finance rollback',
        'finance_api', true, 'connected'
      );
      ALTER TABLE "${schemaName}".evidence
        ADD CONSTRAINT reject_new_evidence CHECK (false) NOT VALID;
    `);

    await expect(
      syncConnectorForUser(
        USER_ID,
        ROLLBACK_CONNECTOR_ID,
        {
          records: [
            {
              id: "rolled-back",
              date: "2026-10-22",
              amount: -40,
              payee: "Rollback",
            },
          ],
        },
      ),
    ).rejects.toThrow();

    const records = await admin.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM "${schemaName}".source_records
      WHERE connector_id = '${ROLLBACK_CONNECTOR_ID}'
    `);
    expect(records.rows[0]?.count).toBe(0);
    const run = await admin.query<{
      status: string;
      records_created: number;
      records_updated: number;
      records_skipped: number;
    }>(`
      SELECT status, records_created, records_updated, records_skipped
      FROM "${schemaName}".sync_runs
      WHERE connector_id = '${ROLLBACK_CONNECTOR_ID}'
      ORDER BY started_at DESC
      LIMIT 1
    `);
    expect(run.rows[0]).toEqual({
      status: "failed",
      records_created: 0,
      records_updated: 0,
      records_skipped: 0,
    });
    const connector = await admin.query<{
      sync_status: string;
      last_sync_at: Date | null;
    }>(`
      SELECT sync_status, last_sync_at
      FROM "${schemaName}".connectors
      WHERE id = '${ROLLBACK_CONNECTOR_ID}'
    `);
    expect(connector.rows[0]).toEqual({
      sync_status: "sync_failed",
      last_sync_at: null,
    });
  });
});
