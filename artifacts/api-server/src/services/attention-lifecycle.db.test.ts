import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const baseMigrationUrl = new URL(
  "../../../../lib/db/migrations/0023_attention_items.sql",
  import.meta.url,
);
const deadlineMigrationUrl = new URL(
  "../../../../lib/db/migrations/0027_attention_deadline_fields.sql",
  import.meta.url,
);

const USER = "11111111-1111-4111-8111-111111111111";

function insertLegacySql(id: string, dueAt: string): string {
  return `
    INSERT INTO "attention_items" (
      "id", "user_id", "title", "due_at", "source_entity_type", "source_entity_id"
    ) VALUES (
      '${id}', '${USER}', 'Legacy deadline', '${dueAt}', 'source_record', 'sr-${id}'
    );
  `;
}

describe("attention_items deadline fields migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec('CREATE TABLE "users" ("id" uuid PRIMARY KEY)');
    await db.exec(`INSERT INTO "users" ("id") VALUES ('${USER}')`);
    await db.exec(await readFile(baseMigrationUrl, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("applies on top of the base table and is idempotent", async () => {
    const sql = await readFile(deadlineMigrationUrl, "utf8");
    await db.exec(sql);
    await expect(db.exec(sql)).resolves.toBeDefined();
  });

  it("backfills legacy rows as confirmed (no re-confirmation nag)", async () => {
    await db.exec(insertLegacySql("attn-1", "2026-08-01T12:00:00Z"));
    await db.exec(await readFile(deadlineMigrationUrl, "utf8"));
    const { rows } = await db.query<{ confirmed_at: string | null; date_confidence: string }>(
      `SELECT confirmed_at, date_confidence FROM attention_items WHERE id = 'attn-1'`,
    );
    expect(rows[0]!.confirmed_at).not.toBeNull();
    expect(rows[0]!.date_confidence).toBe("certain");
  });

  it("stores new deadline-intelligence fields", async () => {
    await db.exec(await readFile(deadlineMigrationUrl, "utf8"));
    await db.exec(`
      INSERT INTO "attention_items" (
        "id", "user_id", "title", "due_at", "source_entity_type", "source_entity_id",
        "date_confidence", "time_zone", "time_known",
        "task_id", "organization_id", "waiting_item_id"
      ) VALUES (
        'attn-2', '${USER}', 'Filing deadline', '2026-09-01T12:00:00Z', 'source_record', 'sr-2',
        'uncertain', 'America/New_York', true,
        'task-1', 'org-1', 'wait-1'
      );
    `);
    const { rows } = await db.query<{
      date_confidence: string;
      time_zone: string | null;
      time_known: boolean;
      confirmed_at: string | null;
      task_id: string | null;
      organization_id: string | null;
      waiting_item_id: string | null;
    }>(`SELECT * FROM attention_items WHERE id = 'attn-2'`);
    const row = rows[0]!;
    expect(row.date_confidence).toBe("uncertain");
    expect(row.time_zone).toBe("America/New_York");
    expect(row.time_known).toBe(true);
    // New rows are not auto-confirmed by the migration.
    expect(row.confirmed_at).toBeNull();
    expect(row.task_id).toBe("task-1");
    expect(row.organization_id).toBe("org-1");
    expect(row.waiting_item_id).toBe("wait-1");
  });

  it("still enforces the source+date dedupe index", async () => {
    await db.exec(await readFile(deadlineMigrationUrl, "utf8"));
    await db.exec(insertLegacySql("attn-3", "2026-08-01T12:00:00Z"));
    await expect(
      db.exec(`
        INSERT INTO "attention_items" (
          "id", "user_id", "title", "due_at", "source_entity_type", "source_entity_id"
        ) VALUES (
          'attn-4', '${USER}', 'Duplicate', '2026-08-01T12:00:00Z', 'source_record', 'sr-attn-3'
        );
      `),
    ).rejects.toThrow();
  });
});
