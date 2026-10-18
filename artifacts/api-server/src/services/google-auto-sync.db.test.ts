import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@workspace/db/schema";

const USER_ID = "11111111-1111-4111-8111-111111111111";
let db: PGlite;
let pgliteDb: ReturnType<typeof drizzle<typeof schema>>;

const mocks = vi.hoisted(() => ({
  enqueueGoogleSyncForUser: vi.fn(),
  nudgeJobWorker: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  getDb: () => pgliteDb,
}));
vi.mock("./connectors", () => ({
  enqueueGoogleSyncForUser: mocks.enqueueGoogleSyncForUser,
}));
vi.mock("./job-worker", () => ({
  nudgeJobWorker: mocks.nudgeJobWorker,
}));

const { stopGoogleAutoSync, syncStaleGoogleConnectors } = await import(
  "./google-auto-sync"
);

beforeEach(async () => {
  process.env.RECALL_GOOGLE_AUTO_SYNC_ENABLED = "true";
  stopGoogleAutoSync();
  mocks.enqueueGoogleSyncForUser.mockReset();
  mocks.nudgeJobWorker.mockReset();
  mocks.enqueueGoogleSyncForUser.mockResolvedValue({
    syncRunId: "new-run",
    jobId: "new-run",
    status: "queued",
    deduped: false,
  });
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
    INSERT INTO connectors
      (id, user_id, name, type, enabled, sync_status, updated_at)
    VALUES
      ('reauth', '${USER_ID}', 'Needs reauth', 'google', true, 'needs_reauth', now() - interval '3 days'),
      ('active', '${USER_ID}', 'Active', 'google', true, 'syncing', now() - interval '2 days'),
      ('eligible', '${USER_ID}', 'Eligible', 'google', true, 'connected', now() - interval '1 day');
    INSERT INTO jobs (id, user_id, type, payload, status)
    VALUES (
      'active-job',
      '${USER_ID}',
      'connector_sync',
      '{"connectorId":"active","syncRunId":"active-run","connectorType":"google"}',
      'queued'
    );
  `);
});

afterEach(async () => {
  stopGoogleAutoSync();
  delete process.env.RECALL_GOOGLE_AUTO_SYNC_ENABLED;
  await db.close();
});

describe("Google scheduler selection", () => {
  it("skips needs_reauth and active connectors without starving the next stale account", async () => {
    await expect(syncStaleGoogleConnectors()).resolves.toBe(1);
    expect(mocks.enqueueGoogleSyncForUser).toHaveBeenCalledWith(
      USER_ID,
      "eligible",
      { scheduled: true },
    );
  });
});
