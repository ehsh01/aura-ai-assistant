import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../lib/db/migrations/0026_waiting_items.sql",
  import.meta.url,
);

const USER = "11111111-1111-4111-8111-111111111111";

function insertSql(id: string, fingerprint: string, status: string): string {
  return `
    INSERT INTO "waiting_items" (
      "id", "user_id", "owner_name", "deliverable",
      "status", "fingerprint", "source_entity_type", "source_entity_id"
    ) VALUES (
      '${id}', '${USER}', 'Carlos', 'As-built documents',
      '${status}', '${fingerprint}', 'source_record', 'sr-1'
    );
  `;
}

describe("waiting_items migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec('CREATE TABLE "users" ("id" uuid PRIMARY KEY)');
    await db.exec(`INSERT INTO "users" ("id") VALUES ('${USER}')`);
    await db.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("is idempotent", async () => {
    await expect(db.exec(await readFile(migrationUrl, "utf8"))).resolves.toBeDefined();
  });

  it("enforces one active commitment per user+fingerprint", async () => {
    await db.exec(insertSql("wait-1", "carlos|as-built documents", "open"));
    await expect(
      db.exec(insertSql("wait-2", "carlos|as-built documents", "open")),
    ).rejects.toThrow();
    await expect(
      db.exec(insertSql("wait-3", "carlos|as-built documents", "snoozed")),
    ).rejects.toThrow();
  });

  it("allows a new commitment once the prior one is terminal", async () => {
    await db.exec(insertSql("wait-1", "carlos|as-built documents", "completed"));
    await expect(
      db.exec(insertSql("wait-2", "carlos|as-built documents", "open")),
    ).resolves.toBeDefined();
    await db.exec(insertSql("wait-3", "carlos|as-built documents", "dismissed"));
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM waiting_items ORDER BY id`,
    );
    expect(rows.rows.map((r) => r.id)).toEqual(["wait-1", "wait-2", "wait-3"]);
  });

  it("allows different fingerprints for the same user", async () => {
    await db.exec(insertSql("wait-1", "carlos|as-built documents", "open"));
    await expect(
      db.exec(insertSql("wait-2", "carlos|city revision", "open")),
    ).resolves.toBeDefined();
  });

  it("stores dates, outcome, and audit-friendly metadata columns", async () => {
    await db.exec(`
      INSERT INTO "waiting_items" (
        "id", "user_id", "owner_name", "owner_org", "deliverable",
        "promised_at", "expected_at", "date_confidence", "status",
        "follow_up_at", "last_outcome", "last_reply_source_record_id",
        "confidence", "fingerprint", "thread_id",
        "source_entity_type", "source_entity_id", "metadata"
      ) VALUES (
        'wait-full', '${USER}', 'Carlos', 'Acme Permits', 'As-built documents',
        '2026-07-20T12:00:00Z', '2026-08-01T12:00:00Z', 'certain', 'open',
        '2026-08-01T12:00:00Z', 'revised_delayed', 'sr-reply-1',
        0.85, 'carlos|as-built documents', 'thread-1',
        'source_record', 'sr-1', '{"needsReview": false}'::jsonb
      );
    `);
    const rows = await db.query<{
      owner_org: string;
      date_confidence: string;
      last_outcome: string;
      thread_id: string;
    }>(`SELECT owner_org, date_confidence, last_outcome, thread_id FROM waiting_items WHERE id = 'wait-full'`);
    expect(rows.rows[0]).toEqual({
      owner_org: "Acme Permits",
      date_confidence: "certain",
      last_outcome: "revised_delayed",
      thread_id: "thread-1",
    });
  });
});
