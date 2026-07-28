import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../lib/db/migrations/0028_capture_intelligence.sql",
  import.meta.url,
);

const USER = "11111111-1111-4111-8111-111111111111";

/** Minimal pre-0028 capture schema (0001 + raw_capture_id link from 0002). */
const BASE_SCHEMA = `
  CREATE TABLE "captures" (
    "id" varchar(64) PRIMARY KEY,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "source_type" varchar(32) NOT NULL DEFAULT 'manual',
    "source_url" text,
    "raw_text" text NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE "capture_items" (
    "id" varchar(64) PRIMARY KEY,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "raw_capture_id" varchar(64) REFERENCES "captures"("id") ON DELETE SET NULL,
    "raw_text" text NOT NULL,
    "cleaned_title" varchar(500) NOT NULL DEFAULT 'Untitled capture',
    "suggested_type" varchar(32) NOT NULL DEFAULT 'note',
    "suggested_priority" varchar(16) NOT NULL DEFAULT 'medium',
    "status" varchar(16) NOT NULL DEFAULT 'pending',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
  );
  INSERT INTO "captures" ("id", "user_id", "raw_text") VALUES
    ('cap-1', '${USER}', 'first'),
    ('cap-2', '${USER}', 'second');
`;

function insertItemSql(id: string, rawCaptureId: string | null, createdAt: string): string {
  const raw = rawCaptureId ? `'${rawCaptureId}'` : "NULL";
  return `
    INSERT INTO "capture_items" ("id", "user_id", "raw_capture_id", "raw_text", "created_at")
    VALUES ('${id}', '${USER}', ${raw}, 'text for ${id}', '${createdAt}');
  `;
}

describe("capture_items intelligence migration (0028)", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec('CREATE TABLE "users" ("id" uuid PRIMARY KEY)');
    await db.exec(`INSERT INTO "users" ("id") VALUES ('${USER}')`);
    await db.exec(BASE_SCHEMA);
  });

  afterEach(async () => {
    await db.close();
  });

  it("applies on top of the base tables and is idempotent", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    await db.exec(sql);
    await expect(db.exec(sql)).resolves.toBeDefined();
  });

  it("cleans up historical duplicate inbox rows (keeps newest per raw capture)", async () => {
    await db.exec(insertItemSql("ci-old", "cap-1", "2026-07-01T00:00:00Z"));
    await db.exec(insertItemSql("ci-new", "cap-1", "2026-07-10T00:00:00Z"));
    await db.exec(await readFile(migrationUrl, "utf8"));

    const { rows } = await db.query<{ id: string; status: string; raw_capture_id: string | null }>(
      `SELECT id, status, raw_capture_id FROM "capture_items" ORDER BY id`,
    );
    expect(rows).toEqual([
      { id: "ci-new", status: "pending", raw_capture_id: "cap-1" },
      { id: "ci-old", status: "dismissed", raw_capture_id: null },
    ]);
  });

  it("enforces one inbox row per raw capture (retry safety)", async () => {
    await db.exec(await readFile(migrationUrl, "utf8"));
    await db.exec(insertItemSql("ci-a", "cap-1", "2026-07-10T00:00:00Z"));
    await expect(
      db.exec(insertItemSql("ci-b", "cap-1", "2026-07-11T00:00:00Z")),
    ).rejects.toThrow();
  });

  it("still allows multiple legacy rows without a raw capture", async () => {
    await db.exec(await readFile(migrationUrl, "utf8"));
    await db.exec(insertItemSql("ci-null-1", null, "2026-07-10T00:00:00Z"));
    await expect(
      db.exec(insertItemSql("ci-null-2", null, "2026-07-11T00:00:00Z")),
    ).resolves.toBeDefined();
  });

  it("stores confidence, suggested links, snooze, and metadata", async () => {
    await db.exec(await readFile(migrationUrl, "utf8"));
    await db.exec(`
      INSERT INTO "capture_items" (
        "id", "user_id", "raw_capture_id", "raw_text", "status",
        "confidence", "suggested_links", "snoozed_until", "metadata"
      ) VALUES (
        'ci-full', '${USER}', 'cap-2', 'Call the city about the permit', 'snoozed',
        0.92,
        '[{"entityType":"person","entityId":"p1","name":"Carlos","matched":true,"reason":"Mentioned in capture"}]'::jsonb,
        '2026-08-01T12:00:00Z',
        '{"types":["task","follow_up"],"promptVersion":"classifyCapture.v2","autoAccepted":false}'::jsonb
      );
    `);
    const { rows } = await db.query<{
      confidence: number;
      suggested_links: { name: string; matched: boolean }[];
      snoozed_until: string | null;
      metadata: { types: string[]; promptVersion: string };
    }>(`SELECT * FROM "capture_items" WHERE id = 'ci-full'`);
    const row = rows[0]!;
    expect(row.confidence).toBeCloseTo(0.92);
    expect(row.suggested_links[0]).toMatchObject({ name: "Carlos", matched: true });
    expect(row.snoozed_until).not.toBeNull();
    expect(row.metadata).toMatchObject({
      types: ["task", "follow_up"],
      promptVersion: "classifyCapture.v2",
    });
  });
});
