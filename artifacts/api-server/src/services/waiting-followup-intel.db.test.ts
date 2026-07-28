import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const baseMigrationUrl = new URL(
  "../../../../lib/db/migrations/0026_waiting_items.sql",
  import.meta.url,
);
const followupMigrationUrl = new URL(
  "../../../../lib/db/migrations/0029_waiting_followup_intelligence.sql",
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

describe("0029_waiting_followup_intelligence migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec('CREATE TABLE "users" ("id" uuid PRIMARY KEY)');
    await db.exec(`INSERT INTO "users" ("id") VALUES ('${USER}')`);
    await db.exec(await readFile(baseMigrationUrl, "utf8"));
    await db.exec(await readFile(followupMigrationUrl, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("is idempotent", async () => {
    await expect(
      db.exec(await readFile(followupMigrationUrl, "utf8")),
    ).resolves.toBeDefined();
  });

  it("stores optional project/task links", async () => {
    await db.exec(`
      INSERT INTO "waiting_items" (
        "id", "user_id", "owner_name", "deliverable", "status", "fingerprint",
        "source_entity_type", "source_entity_id", "project_id", "task_id"
      ) VALUES (
        'wait-linked', '${USER}', 'Carlos', 'Inspection confirmation', 'open',
        'carlos|inspection confirmation', 'capture_item', 'ci-1', 'proj-9', 'task-4'
      );
    `);
    const rows = await db.query<{ project_id: string; task_id: string }>(
      `SELECT project_id, task_id FROM waiting_items WHERE id = 'wait-linked'`,
    );
    expect(rows.rows[0]).toEqual({ project_id: "proj-9", task_id: "task-4" });
  });

  it("candidates join the dedupe guarantee (reprocessing never duplicates)", async () => {
    await db.exec(insertSql("wait-1", "carlos|as-built documents", "candidate"));
    await expect(
      db.exec(insertSql("wait-2", "carlos|as-built documents", "candidate")),
    ).rejects.toThrow();
    await expect(
      db.exec(insertSql("wait-3", "carlos|as-built documents", "open")),
    ).rejects.toThrow();
    await expect(
      db.exec(insertSql("wait-4", "carlos|as-built documents", "snoozed")),
    ).rejects.toThrow();
  });

  it("an open commitment blocks a duplicate candidate and vice versa", async () => {
    await db.exec(insertSql("wait-1", "carlos|as-built documents", "open"));
    await expect(
      db.exec(insertSql("wait-2", "carlos|as-built documents", "candidate")),
    ).rejects.toThrow();
  });

  it("a dismissed candidate frees the fingerprint for a fresh suggestion", async () => {
    await db.exec(insertSql("wait-1", "carlos|as-built documents", "candidate"));
    await db.exec(`UPDATE waiting_items SET status = 'dismissed' WHERE id = 'wait-1'`);
    await expect(
      db.exec(insertSql("wait-2", "carlos|as-built documents", "candidate")),
    ).resolves.toBeDefined();
  });

  it("terminal commitments still allow a brand-new commitment", async () => {
    await db.exec(insertSql("wait-1", "carlos|as-built documents", "completed"));
    await expect(
      db.exec(insertSql("wait-2", "carlos|as-built documents", "open")),
    ).resolves.toBeDefined();
  });
});
