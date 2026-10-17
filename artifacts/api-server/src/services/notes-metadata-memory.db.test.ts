import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@workspace/db/schema";
import { ListNotesResponse } from "@workspace/api-zod";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_COUNT = 5_000;
const LARGE_TEXT_CHARS = 8_192;

let db: PGlite;
let queries: string[] = [];
let pgliteDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("../lib/db", () => ({ getDb: () => pgliteDb }));

const {
  HOME_RECENT_NOTES_LIMIT,
  NOTE_METADATA_SELECT,
  listNoteMetadataPageForUser,
} = await import("./notes");

describe("bounded note metadata for /notes and /home", () => {
  beforeAll(async () => {
    db = new PGlite();
    pgliteDb = drizzle(db, {
      schema,
      logger: {
        logQuery(query) {
          queries.push(query);
        },
      },
    });
    await db.exec(`
      CREATE TABLE notes (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL,
        notebook_id varchar(64),
        project_id varchar(64),
        primary_person_id varchar(64),
        title varchar(500) NOT NULL,
        content text NOT NULL,
        preview text NOT NULL,
        summary text,
        content_hash varchar(64),
        fact_bullets jsonb NOT NULL DEFAULT '[]'::jsonb,
        content_format varchar(16) NOT NULL DEFAULT 'plain',
        tags jsonb NOT NULL DEFAULT '[]'::jsonb,
        pinned boolean NOT NULL DEFAULT false,
        vault varchar(32) NOT NULL DEFAULT 'personal',
        search_document text NOT NULL DEFAULT '',
        search_tsv tsvector,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE note_attachments (
        id varchar(128) PRIMARY KEY,
        user_id uuid NOT NULL,
        note_id varchar(64) NOT NULL,
        resource_hash varchar(64) NOT NULL DEFAULT '',
        file_name varchar(500) NOT NULL DEFAULT 'scan.txt',
        mime_type varchar(128) NOT NULL DEFAULT 'text/plain',
        size_bytes integer NOT NULL DEFAULT 0,
        storage_path varchar(1024) NOT NULL DEFAULT '',
        extracted_text text,
        extracted_at timestamptz,
        content_hash varchar(64),
        ai_ocr_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO notes (
        id, user_id, title, content, preview, search_document, created_at, updated_at
      )
      SELECT
        'note-' || lpad(g::text, 5, '0'),
        '${USER_ID}',
        'Note ' || g,
        repeat('B', ${LARGE_TEXT_CHARS}),
        'Preview ' || g,
        repeat('B', ${LARGE_TEXT_CHARS}) || repeat('O', ${LARGE_TEXT_CHARS}),
        '2026-01-01T00:00:00Z'::timestamptz + g * interval '1 second',
        '2026-01-01T00:00:00Z'::timestamptz + g * interval '1 second'
      FROM generate_series(1, ${NOTE_COUNT}) g;
      INSERT INTO note_attachments (id, user_id, note_id, extracted_text)
      SELECT
        'attachment-' || lpad(g::text, 5, '0'),
        '${USER_ID}',
        'note-' || lpad(g::text, 5, '0'),
        repeat('O', ${LARGE_TEXT_CHARS})
      FROM generate_series(1, ${NOTE_COUNT}) g;
    `);
    const migration = await readFile(
      new URL(
        "../../../../lib/db/migrations/0040_notes_metadata_pagination.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(migration);
    await expect(db.exec(migration)).resolves.toBeDefined();
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("coalesces parallel first-page work and never selects bodies or OCR", async () => {
    queries = [];
    globalThis.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const [notesPage, homePage] = await Promise.all([
      listNoteMetadataPageForUser(USER_ID, { limit: 100 }),
      listNoteMetadataPageForUser(USER_ID, { limit: HOME_RECENT_NOTES_LIMIT }),
    ]);
    const heapAfter = process.memoryUsage().heapUsed;

    expect(notesPage.notes).toHaveLength(100);
    expect(homePage).toBe(notesPage);
    expect(notesPage.hasMore).toBe(true);
    expect(notesPage.nextCursor).toBeTruthy();
    const endpointResponse = ListNotesResponse.parse(notesPage);
    expect(Buffer.byteLength(JSON.stringify(endpointResponse))).toBeLessThan(
      100_000,
    );
    expect(Math.max(0, heapAfter - heapBefore)).toBeLessThan(16 * 1024 * 1024);

    const metadataQueries = queries.filter(
      (query) =>
        /from "notes"/i.test(query) &&
        /order by "notes"\."updated_at"/i.test(query),
    );
    expect(metadataQueries).toHaveLength(1);
    expect(metadataQueries[0]).not.toMatch(
      /"notes"\."(?:content|search_document|search_tsv|summary|fact_bullets)"/i,
    );
    expect(metadataQueries[0]).not.toMatch(
      /"note_attachments"\."extracted_text"/i,
    );
    expect(Object.keys(NOTE_METADATA_SELECT)).toEqual([
      "id",
      "title",
      "preview",
      "contentFormat",
      "tags",
      "pinned",
      "notebookId",
      "projectId",
      "primaryPersonId",
      "attachmentCount",
      "createdAt",
      "updatedAt",
    ]);
  });

  it("uses an opaque keyset cursor and keeps every page bounded", async () => {
    const first = await listNoteMetadataPageForUser(USER_ID, { limit: 100 });
    const second = await listNoteMetadataPageForUser(USER_ID, {
      limit: 100,
      cursor: first.nextCursor!,
    });

    expect(second.notes).toHaveLength(100);
    expect(
      new Set([...first.notes, ...second.notes].map((note) => note.id)).size,
    ).toBe(200);
    expect(Buffer.byteLength(JSON.stringify(second))).toBeLessThan(100_000);
  });
});
