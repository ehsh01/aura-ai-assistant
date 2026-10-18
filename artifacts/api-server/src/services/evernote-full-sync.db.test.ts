import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@workspace/db/schema";

let pgliteDb: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../lib/db", () => ({ getDb: () => pgliteDb }));

const {
  persistEvernoteTaxonomy,
  processOneEvernoteAttachment,
  resetInterruptedEvernoteAttachments,
} = await import("./evernote-full-sync");

const sourceSearchMigrationUrl = new URL(
  "../../../../lib/db/migrations/0037_evernote_source_search.sql",
  import.meta.url,
);
const migrationUrl = new URL(
  "../../../../lib/db/migrations/0038_evernote_full_fidelity.sql",
  import.meta.url,
);

describe("Evernote full-fidelity migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    pgliteDb = drizzle(db, { schema });
    await db.exec(`
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE connectors (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id)
      );
      CREATE TABLE sync_runs (
        id varchar(64) PRIMARY KEY,
        records_fetched integer NOT NULL DEFAULT 0,
        records_created integer NOT NULL DEFAULT 0,
        records_updated integer NOT NULL DEFAULT 0,
        records_failed integer NOT NULL DEFAULT 0
      );
      CREATE TABLE source_records (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        connector_id varchar(64) NOT NULL REFERENCES connectors(id),
        external_id varchar(255) NOT NULL,
        record_type varchar(32) NOT NULL,
        record_title varchar(500),
        record_text text,
        record_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.exec(await readFile(sourceSearchMigrationUrl, "utf8"));
    await db.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("is idempotent and indexes extracted attachment text", async () => {
    await expect(
      db.exec(await readFile(migrationUrl, "utf8")),
    ).resolves.toBeDefined();
    const userId = "11111111-1111-4111-8111-111111111111";
    await db.exec(`
      INSERT INTO users (id) VALUES ('${userId}');
      INSERT INTO connectors (id, user_id) VALUES ('connector', '${userId}');
      INSERT INTO source_records (
        id, user_id, connector_id, external_id, record_type, record_title, record_text
      ) VALUES (
        'source', '${userId}', 'connector', 'note', 'evernote_note',
        'Large note', repeat('foundation permit ', 20000)
      );
      INSERT INTO evernote_attachments (
        id, user_id, connector_id, source_record_id, external_id,
        file_name, extracted_text, fetch_state
      ) VALUES (
        'asset', '${userId}', 'connector', 'source', 'resource',
        'permit.pdf', 'Inspection approved the foundation permit', 'complete'
      );
    `);
    const hit = await db.query<{ id: string }>(`
      SELECT id FROM evernote_attachments
      WHERE search_tsv @@ to_tsquery('simple', 'foundation:* & permit:*')
    `);
    expect(hit.rows).toEqual([{ id: "asset" }]);
    const source = await db.query<{
      body_chars: number;
      search_chars: number;
      searchable: boolean;
    }>(`
      SELECT
        length(record_text)::int AS body_chars,
        length(search_document)::int AS search_chars,
        search_tsv @@ to_tsquery('simple', 'foundation:*') AS searchable
      FROM source_records
      WHERE id = 'source'
    `);
    expect(source.rows[0]?.body_chars).toBeGreaterThan(180_000);
    expect(source.rows[0]?.search_chars).toBeLessThan(181_000);
    expect(source.rows[0]?.searchable).toBe(true);
  });

  it("backfills GUID-only notebook names and refreshes source-record search", async () => {
    const userId = "22222222-2222-4222-8222-222222222222";
    const notebookGuid = "cf240195-dcdb-486a-8ab5-000000000001";
    await db.exec(`
      INSERT INTO users (id) VALUES ('${userId}');
      INSERT INTO connectors (id, user_id) VALUES ('connector', '${userId}');
      INSERT INTO source_records (
        id, user_id, connector_id, external_id, record_type,
        record_title, record_text, record_metadata
      ) VALUES (
        'source-guid', '${userId}', 'connector', 'note-guid', 'evernote_note',
        'Sanitized title', 'Sanitized body',
        '{"contentHash":"same","notebookGuid":"${notebookGuid}","notebookName":"${notebookGuid}"}'
      );
    `);
    const before = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM source_records
      WHERE record_metadata->>'notebookName' = record_metadata->>'notebookGuid'
    `);

    await persistEvernoteTaxonomy(userId, "connector", {
      notebooks: [
        {
          id: notebookGuid,
          name: "Sanitized Projects",
          parentId: null,
          stack: null,
          spaceId: null,
          access: null,
          metadata: {},
        },
      ],
      tags: [],
      spaces: [],
    });

    const after = await db.query<{
      guid_named: number;
      notebook_name: string;
      searchable: boolean;
    }>(`
      SELECT
        count(*) FILTER (
          WHERE record_metadata->>'notebookName' = record_metadata->>'notebookGuid'
        ) OVER ()::int AS guid_named,
        record_metadata->>'notebookName' AS notebook_name,
        search_tsv @@ to_tsquery('simple', 'sanitized:* & projects:*') AS searchable
      FROM source_records
      WHERE id = 'source-guid'
    `);
    expect(before.rows[0]?.count).toBe(1);
    expect(after.rows[0]).toEqual({
      guid_named: 0,
      notebook_name: "Sanitized Projects",
      searchable: true,
    });
  });

  it("resets only legacy get_attachment argument failures for retry", async () => {
    const userId = "33333333-3333-4333-8333-333333333333";
    await db.exec(`
      INSERT INTO users (id) VALUES ('${userId}');
      INSERT INTO connectors (id, user_id) VALUES ('connector', '${userId}');
      INSERT INTO source_records (
        id, user_id, connector_id, external_id, record_type
      ) VALUES (
        'source-retry', '${userId}', 'connector', 'note-guid', 'evernote_note'
      );
      INSERT INTO evernote_attachments (
        id, user_id, connector_id, source_record_id, external_id,
        evernote_hash, fetch_state, fetch_error, attempts
      ) VALUES
        (
          'schema-failure', '${userId}', 'connector', 'source-retry', 'resource-1',
          'hash-1', 'failed', 'Unrecognized key: attachmentId', 3
        ),
        (
          'ordinary-failure', '${userId}', 'connector', 'source-retry', 'resource-2',
          'hash-2', 'failed', 'download connection reset', 3
        );
    `);

    await resetInterruptedEvernoteAttachments("connector");

    const rows = await db.query<{
      id: string;
      fetch_state: string;
      attempts: number;
    }>(`
      SELECT id, fetch_state, attempts
      FROM evernote_attachments
      ORDER BY id
    `);
    expect(rows.rows).toEqual([
      { id: "ordinary-failure", fetch_state: "failed", attempts: 3 },
      { id: "schema-failure", fetch_state: "pending", attempts: 0 },
    ]);
  });

  it("skips a known 15 MB-plus PDF before calling get_attachment", async () => {
    const userId = "44444444-4444-4444-8444-444444444444";
    await db.exec(`
      INSERT INTO users (id) VALUES ('${userId}');
      INSERT INTO connectors (id, user_id) VALUES ('connector', '${userId}');
      INSERT INTO source_records (
        id, user_id, connector_id, external_id, record_type
      ) VALUES (
        'source-pdf', '${userId}', 'connector', 'parent-note-guid', 'evernote_note'
      );
      INSERT INTO evernote_attachments (
        id, user_id, connector_id, source_record_id, external_id,
        evernote_hash, mime, file_name, size_bytes
      ) VALUES (
        'large-pdf', '${userId}', 'connector', 'source-pdf', 'resource-pdf',
        'pdf-hash', 'application/pdf', 'large.pdf', ${16 * 1024 * 1024}
      );
    `);
    const callTool = vi.fn();

    await expect(
      processOneEvernoteAttachment({ callTool }, "connector"),
    ).resolves.toBe(true);
    expect(callTool).not.toHaveBeenCalled();
    const result = await db.query<{
      fetch_state: string;
      fetch_error: string;
    }>(`
      SELECT fetch_state, fetch_error
      FROM evernote_attachments
      WHERE id = 'large-pdf'
    `);
    expect(result.rows[0]).toMatchObject({
      fetch_state: "skipped_too_large",
    });
    expect(result.rows[0]?.fetch_error).toContain("PDF metadata size");
  });

  it("keeps the row pending and stops on MCP argument validation", async () => {
    const userId = "55555555-5555-4555-8555-555555555555";
    await db.exec(`
      INSERT INTO users (id) VALUES ('${userId}');
      INSERT INTO connectors (id, user_id) VALUES ('connector', '${userId}');
      INSERT INTO source_records (
        id, user_id, connector_id, external_id, record_type
      ) VALUES (
        'source-schema', '${userId}', 'connector', 'parent-note-guid', 'evernote_note'
      );
      INSERT INTO evernote_attachments (
        id, user_id, connector_id, source_record_id, external_id,
        evernote_hash, mime, file_name, size_bytes
      ) VALUES (
        'schema-pending', '${userId}', 'connector', 'source-schema', 'resource',
        'resource-hash', 'text/plain', 'small.txt', 20
      );
    `);
    const previousPace = process.env.EVERNOTE_MCP_PACE_MS;
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    try {
      await expect(
        processOneEvernoteAttachment(
          {
            async callTool() {
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: "Required: noteId; Unrecognized key(s): attachmentId",
                  },
                ],
              };
            },
          },
          "connector",
        ),
      ).rejects.toMatchObject({
        name: "EvernoteAttachmentCodeError",
        nonRetryable: true,
      });
    } finally {
      if (previousPace == null) delete process.env.EVERNOTE_MCP_PACE_MS;
      else process.env.EVERNOTE_MCP_PACE_MS = previousPace;
    }
    const result = await db.query<{
      fetch_state: string;
      fetch_error: string;
      attempts: number;
    }>(`
      SELECT fetch_state, fetch_error, attempts
      FROM evernote_attachments
      WHERE id = 'schema-pending'
    `);
    expect(result.rows[0]).toMatchObject({
      fetch_state: "pending",
      attempts: 0,
    });
    expect(result.rows[0]?.fetch_error).toContain(
      "non-retryable get_attachment code error",
    );
  });
});
