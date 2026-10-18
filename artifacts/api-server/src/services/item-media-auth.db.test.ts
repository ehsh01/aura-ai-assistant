import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@workspace/db/schema";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const attachmentRoot = await mkdtemp(
  path.join(tmpdir(), "recall-owner-media-"),
);
process.env.ATTACHMENTS_DIR = attachmentRoot;

let db: PGlite;
let pgliteDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("../lib/db", () => ({ getDb: () => pgliteDb }));

const { deleteItemForUser, getItemMediaForUser } = await import("./items");
const { getRecallDocumentForUser } = await import("./item-documents");

describe("owner-only saved file access", () => {
  beforeAll(async () => {
    db = new PGlite();
    pgliteDb = drizzle(db, { schema });
    await db.exec(`
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE captures (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id)
      );
      CREATE TABLE documents (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        file_name varchar(500) NOT NULL,
        file_type varchar(255),
        storage_path text
      );
      INSERT INTO users (id) VALUES ('${OWNER}'), ('${OTHER}');
    `);
    await db.exec(
      await readFile(
        new URL(
          "../../../../lib/db/migrations/0039_saved_items.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const relativePath = path.join(OWNER, "items", "item-private", "roof.pdf");
    await mkdir(path.dirname(path.join(attachmentRoot, relativePath)), {
      recursive: true,
    });
    await writeFile(path.join(attachmentRoot, relativePath), "private");
    const documentPath = path.join(OWNER, "documents", "policy.pdf");
    await mkdir(path.dirname(path.join(attachmentRoot, documentPath)), {
      recursive: true,
    });
    await writeFile(path.join(attachmentRoot, documentPath), "document");
    await db.exec(`
      INSERT INTO captures (id, user_id) VALUES ('capture-private', '${OWNER}');
      INSERT INTO items (id, user_id, capture_id, kind, title, body_text, media)
      VALUES (
        'item-private',
        '${OWNER}',
        'capture-private',
        'pdf',
        'Roof warranty',
        '',
        '{"storagePath":"${relativePath.replaceAll("\\", "\\\\")}","fileName":"roof.pdf","mimeType":"application/pdf"}'::jsonb
      );
      INSERT INTO documents (id, user_id, file_name, file_type, storage_path)
      VALUES (
        'document-private',
        '${OWNER}',
        'policy.pdf',
        'application/pdf',
        '${documentPath.replaceAll("\\", "\\\\")}'
      );
    `);
  });

  afterAll(async () => {
    await db.close();
    await rm(attachmentRoot, { recursive: true, force: true });
  });

  it("returns the file to its owner and a 404-equivalent null to another user", async () => {
    await expect(
      getItemMediaForUser(OWNER, "item-private"),
    ).resolves.toMatchObject({
      fileName: "roof.pdf",
      mimeType: "application/pdf",
    });
    await expect(
      getItemMediaForUser(OTHER, "item-private"),
    ).resolves.toBeNull();
  });

  it("does not let another user delete the owner's item", async () => {
    await expect(deleteItemForUser(OTHER, "item-private")).resolves.toBe(false);
    await expect(
      getItemMediaForUser(OWNER, "item-private"),
    ).resolves.not.toBeNull();
  });

  it("scopes legacy document bytes to their owner", async () => {
    await expect(
      getRecallDocumentForUser(OWNER, "document-private"),
    ).resolves.toMatchObject({
      fileName: "policy.pdf",
      mimeType: "application/pdf",
    });
    await expect(
      getRecallDocumentForUser(OTHER, "document-private"),
    ).resolves.toBeNull();
  });

  it("Undo removes both the private bytes and their raw capture", async () => {
    await expect(deleteItemForUser(OWNER, "item-private")).resolves.toBe(true);
    await expect(
      getItemMediaForUser(OWNER, "item-private"),
    ).resolves.toBeNull();
    const captures = await db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM captures WHERE id = 'capture-private'",
    );
    expect(captures.rows[0]?.count).toBe("0");
  });
});
