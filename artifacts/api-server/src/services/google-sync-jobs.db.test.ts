import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@workspace/db/schema";
import { GOOGLE_SYNC_MAX_CURSOR_RETRIES } from "./job-queue";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTOR_ID = "google-test";

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

const {
  createGoogleConnectorForUser,
  enqueueGoogleSyncForUser,
  ensureGoogleAccessToken,
  failConnectorJobAndRun,
  googleSyncMaxRowsPerTick,
  liveSearchGmailForUser,
  processGoogleSyncJob,
} = await import("./connectors");

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function createConnector(settings: Record<string, unknown>) {
  await pgliteDb.insert(schema.connectors).values({
    id: CONNECTOR_ID,
    userId: USER_ID,
    name: "Google · test@example.com",
    type: "google",
    authType: "oauth",
    enabled: true,
    syncStatus: "connected",
    settings,
  });
}

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
    CREATE TABLE audit_log (
      id varchar(64) PRIMARY KEY,
      user_id uuid REFERENCES users(id),
      action varchar(64) NOT NULL,
      entity_type varchar(32),
      entity_id varchar(64),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE source_records (
      id varchar(64) PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id),
      connector_id varchar(64) NOT NULL REFERENCES connectors(id),
      external_id varchar(255) NOT NULL CHECK (external_id <> 'gmail:blocked'),
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
    CREATE TABLE entity_embeddings (
      id varchar(64) PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id),
      entity_type varchar(32) NOT NULL,
      entity_id varchar(64) NOT NULL,
      content_hash varchar(32) NOT NULL,
      model varchar(64) NOT NULL,
      dims integer NOT NULL,
      vector jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE evidence (
      id varchar(64) PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id),
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
    INSERT INTO users (id) VALUES ('${USER_ID}');
  `);
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.RECALL_GOOGLE_SYNC_MAX_ROWS_PER_TICK;
  await db.close();
});

describe("durable Google sync jobs", () => {
  it("defaults the per-tick row cap to 500 and accepts a bounded override", () => {
    delete process.env.RECALL_GOOGLE_SYNC_MAX_ROWS_PER_TICK;
    expect(googleSyncMaxRowsPerTick()).toBe(500);
    process.env.RECALL_GOOGLE_SYNC_MAX_ROWS_PER_TICK = "75";
    expect(googleSyncMaxRowsPerTick()).toBe(75);
    delete process.env.RECALL_GOOGLE_SYNC_MAX_ROWS_PER_TICK;
  });

  it("stores granted OAuth scopes when connecting", async () => {
    await createGoogleConnectorForUser(USER_ID, {
      email: "scope@example.com",
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 3600,
      scopes: ["openid", "https://www.googleapis.com/auth/gmail.readonly"],
    });
    const [connector] = await pgliteDb.select().from(schema.connectors);
    expect(connector?.settings.grantedScopes).toEqual([
      "openid",
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
  });

  it("deduplicates an already queued connector sync", async () => {
    await createConnector({});
    const first = await enqueueGoogleSyncForUser(USER_ID, CONNECTOR_ID);
    const second = await enqueueGoogleSyncForUser(USER_ID, CONNECTOR_ID);

    expect(second).toMatchObject({
      syncRunId: first.syncRunId,
      jobId: first.jobId,
      deduped: true,
    });
    const jobs = await pgliteDb.select().from(schema.jobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.maxAttempts).toBe(GOOGLE_SYNC_MAX_CURSOR_RETRIES);
  });

  it("replaces a partial error with the terminal whole-slice failure", async () => {
    await createConnector({});
    const queued = await enqueueGoogleSyncForUser(USER_ID, CONNECTOR_ID);
    await pgliteDb
      .update(schema.syncRuns)
      .set({
        errorMessage: "old partial error",
        metadata: { errors: ["old partial error"] },
      })
      .where(eq(schema.syncRuns.id, queued.syncRunId));

    await pgliteDb
      .update(schema.jobs)
      .set({ status: "processing", attempts: 3 })
      .where(eq(schema.jobs.id, queued.jobId));
    await failConnectorJobAndRun(
      USER_ID,
      queued.jobId,
      queued.syncRunId,
      "Connector sync database error (22P02)",
    );
    const [run] = await pgliteDb.select().from(schema.syncRuns);
    expect(run).toMatchObject({
      status: "failed",
      errorMessage: "Connector sync database error (22P02)",
    });
    const [job] = await pgliteDb.select().from(schema.jobs);
    expect(job).toMatchObject({
      status: "failed",
      lastError: "Connector sync database error (22P02)",
    });
    const [connector] = await pgliteDb.select().from(schema.connectors);
    expect(connector?.syncStatus).toBe("sync_failed");
  });

  it("sets needs_reauth when refresh returns invalid_grant", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    await createConnector({
      googleEmail: "test@example.com",
      accessToken: "expired",
      accessTokenExpiresAt: "2020-01-01T00:00:00.000Z",
      refreshToken: "revoked",
    });
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: "invalid_grant" }, 400),
    ) as typeof fetch;
    await expect(
      liveSearchGmailForUser(USER_ID, "from:someone@example.com"),
    ).rejects.toMatchObject({ needsReauth: true });
    const [updated] = await pgliteDb.select().from(schema.connectors);
    expect(updated?.syncStatus).toBe("needs_reauth");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
    await expect(
      liveSearchGmailForUser(USER_ID, "from:someone@example.com"),
    ).rejects.toMatchObject({ needsReauth: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("updates granted OAuth scopes on refresh", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    await createConnector({
      googleEmail: "test@example.com",
      accessToken: "expired",
      accessTokenExpiresAt: "2020-01-01T00:00:00.000Z",
      refreshToken: "refresh",
      grantedScopes: ["openid"],
    });
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        access_token: "fresh",
        expires_in: 3600,
        scope: "openid https://www.googleapis.com/auth/drive.readonly",
      }),
    ) as typeof fetch;
    const [connector] = await pgliteDb.select().from(schema.connectors);

    await ensureGoogleAccessToken(connector!);
    const [updated] = await pgliteDb.select().from(schema.connectors);
    expect(updated?.settings.grantedScopes).toEqual([
      "openid",
      "https://www.googleapis.com/auth/drive.readonly",
    ]);
  });

  it("persists a per-source error when the remaining sources succeed", async () => {
    await createConnector({
      googleEmail: "test@example.com",
      accessToken: "fresh",
      accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
      refreshToken: "refresh",
    });
    globalThis.fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "gmail.googleapis.com") {
        return jsonResponse({ error: "Gmail disabled" }, 403);
      }
      if (
        url.hostname === "www.googleapis.com" &&
        url.pathname.includes("calendar")
      ) {
        return jsonResponse({ items: [] });
      }
      if (url.hostname === "people.googleapis.com") {
        return jsonResponse({ connections: [] });
      }
      if (
        url.hostname === "www.googleapis.com" &&
        url.pathname === "/drive/v3/files"
      ) {
        return jsonResponse({ files: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const queued = await enqueueGoogleSyncForUser(USER_ID, CONNECTOR_ID);
    await expect(
      processGoogleSyncJob(USER_ID, CONNECTOR_ID, queued.syncRunId),
    ).resolves.toBe(true);

    const [run] = await pgliteDb.select().from(schema.syncRuns);
    expect(run?.status).toBe("partial_success");
    expect(run?.sourceErrors.gmail).toContain("Google API 403");
    expect(run?.errorMessage).toContain("gmail:");
    expect(run?.metadata).toMatchObject({
      googleSync: {
        sources: {
          gmail: { ok: false },
          drive: { ok: true },
        },
      },
    });
    const [connector] = await pgliteDb.select().from(schema.connectors);
    expect(connector?.lastSyncAt).toBeNull();
  });

  it("saves a malformed-surrogate Gmail message and continues the slice", async () => {
    await createConnector({
      googleEmail: "test@example.com",
      accessToken: "fresh",
      accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
      refreshToken: "refresh",
    });
    globalThis.fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      if (
        url.hostname === "gmail.googleapis.com" &&
        url.pathname.endsWith("/messages")
      ) {
        return jsonResponse({ messages: [{ id: "bad" }, { id: "good" }] });
      }
      if (url.pathname.endsWith("/messages/bad")) {
        return jsonResponse({
          id: "bad",
          snippet: "snippet\ud83d",
          payload: {
            headers: [
              { name: "Subject", value: "subject\ud83d" },
              { name: "From", value: "Bad\ud83d <bad@example.com>" },
            ],
          },
        });
      }
      if (url.pathname.endsWith("/messages/good")) {
        return jsonResponse({
          id: "good",
          snippet: "next message",
          payload: {
            headers: [{ name: "Subject", value: "Good message" }],
          },
        });
      }
      if (
        url.hostname === "www.googleapis.com" &&
        url.pathname.includes("calendar")
      ) {
        return jsonResponse({ items: [] });
      }
      if (url.hostname === "people.googleapis.com") {
        return jsonResponse({ connections: [] });
      }
      if (
        url.hostname === "www.googleapis.com" &&
        url.pathname === "/drive/v3/files"
      ) {
        return jsonResponse({ files: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const queued = await enqueueGoogleSyncForUser(USER_ID, CONNECTOR_ID);
    await expect(
      processGoogleSyncJob(USER_ID, CONNECTOR_ID, queued.syncRunId),
    ).resolves.toBe(true);

    const rows = await pgliteDb
      .select()
      .from(schema.sourceRecords)
      .orderBy(schema.sourceRecords.externalId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      externalId: "gmail:bad",
      recordTitle: "subject\ufffd",
    });
    expect(JSON.stringify(rows[0]?.recordMetadata)).not.toMatch(
      /[\ud800-\udfff]/,
    );
    expect(rows[1]?.externalId).toBe("gmail:good");
  });

  it("skips one constrained record by id and saves the rest of the slice", async () => {
    await createConnector({
      googleEmail: "test@example.com",
      accessToken: "fresh",
      accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
      refreshToken: "refresh",
    });
    globalThis.fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      if (
        url.hostname === "gmail.googleapis.com" &&
        url.pathname.endsWith("/messages")
      ) {
        return jsonResponse({
          messages: [{ id: "blocked" }, { id: "after-blocked" }],
        });
      }
      if (url.pathname.endsWith("/messages/blocked")) {
        return jsonResponse({
          id: "blocked",
          snippet: "content must not appear in logs",
          payload: {
            headers: [{ name: "Subject", value: "Blocked content" }],
          },
        });
      }
      if (url.pathname.endsWith("/messages/after-blocked")) {
        return jsonResponse({
          id: "after-blocked",
          snippet: "saved",
          payload: {
            headers: [{ name: "Subject", value: "Saved after failure" }],
          },
        });
      }
      if (
        url.hostname === "www.googleapis.com" &&
        url.pathname.includes("calendar")
      ) {
        return jsonResponse({ items: [] });
      }
      if (url.hostname === "people.googleapis.com") {
        return jsonResponse({ connections: [] });
      }
      if (
        url.hostname === "www.googleapis.com" &&
        url.pathname === "/drive/v3/files"
      ) {
        return jsonResponse({ files: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const queued = await enqueueGoogleSyncForUser(USER_ID, CONNECTOR_ID);
    await expect(
      processGoogleSyncJob(USER_ID, CONNECTOR_ID, queued.syncRunId),
    ).resolves.toBe(true);

    const rows = await pgliteDb.select().from(schema.sourceRecords);
    expect(rows.map((row) => row.externalId)).toEqual([
      "gmail:after-blocked",
    ]);
    const [run] = await pgliteDb.select().from(schema.syncRuns);
    expect(run).toMatchObject({
      status: "partial_success",
      recordsCreated: 1,
      recordsFailed: 1,
    });
    expect(run?.metadata.errors).toEqual([
      "gmail:blocked skipped (23514)",
    ]);
    const [connector] = await pgliteDb.select().from(schema.connectors);
    expect(connector?.lastSyncAt).toBeNull();
  });
});
