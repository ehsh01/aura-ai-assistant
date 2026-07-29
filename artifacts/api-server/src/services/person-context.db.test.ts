import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getDb() is consulted lazily inside service functions, so the factory can
// close over this holder even though it is assigned in beforeEach.
let pgliteDb: ReturnType<typeof drizzle>;
vi.mock("../lib/db", () => ({ getDb: () => pgliteDb }));

const { listRecentMessagesForPerson } = await import("./person-context");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function insertMessage(input: {
  id: string;
  userId: string;
  title: string;
  text: string;
  senderEmail: string;
  at: string;
}): string {
  const q = (s: string) => s.replace(/'/g, "''");
  return `
    INSERT INTO "source_records" (
      "id", "user_id", "record_type", "record_title", "record_text",
      "record_metadata", "source_url", "source_created_at"
    ) VALUES (
      '${input.id}', '${input.userId}', 'gmail_message', '${q(input.title)}', '${q(input.text)}',
      '{"senderEmail": "${input.senderEmail}", "senderName": "Sender"}'::jsonb,
      'https://mail.example/${input.id}', '${input.at}'
    );
  `;
}

describe("listRecentMessagesForPerson (user scoping)", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE "source_records" (
        "id" varchar(64) PRIMARY KEY,
        "user_id" uuid NOT NULL,
        "record_type" varchar(64) NOT NULL,
        "record_title" text,
        "record_text" text,
        "record_metadata" jsonb,
        "source_url" text,
        "source_created_at" timestamptz
      );
    `);
    pgliteDb = drizzle(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("never returns another user's messages, even for the same person email", async () => {
    await db.exec(
      insertMessage({
        id: "sr-a1",
        userId: USER_A,
        title: "Inspection update",
        text: "From: Carlos <carlos@example.com>",
        senderEmail: "carlos@example.com",
        at: "2026-07-25T10:00:00Z",
      }),
    );
    await db.exec(
      insertMessage({
        id: "sr-b1",
        userId: USER_B,
        title: "Other user's private mail",
        text: "From: Carlos <carlos@example.com>",
        senderEmail: "carlos@example.com",
        at: "2026-07-26T10:00:00Z",
      }),
    );

    const messages = await listRecentMessagesForPerson(USER_A, {
      email: "carlos@example.com",
      displayName: "Carlos Rivera",
    });
    expect(messages.map((m) => m.id)).toEqual(["sr-a1"]);
    expect(messages[0]!.title).toBe("Inspection update");
    expect(messages[0]!.sourceUrl).toBe("https://mail.example/sr-a1");

    expect(
      await listRecentMessagesForPerson(USER_B, {
        email: "carlos@example.com",
        displayName: "Carlos Rivera",
      }),
    ).toHaveLength(1);
  });

  it("matches by email (not just name) so same-named people don't bleed together", async () => {
    await db.exec(
      insertMessage({
        id: "sr-a1",
        userId: USER_A,
        title: "From the right Carlos",
        text: "From: Carlos <carlos@example.com>",
        senderEmail: "carlos@example.com",
        at: "2026-07-25T10:00:00Z",
      }),
    );
    await db.exec(
      insertMessage({
        id: "sr-a2",
        userId: USER_A,
        title: "Carlos mentioned in passing",
        text: "Sandra wrote: Carlos Rivera should see this",
        senderEmail: "sandra@example.com",
        at: "2026-07-24T10:00:00Z",
      }),
    );

    // Email-known person: only messages touching that email address.
    const byEmail = await listRecentMessagesForPerson(USER_A, {
      email: "carlos@example.com",
      displayName: "Carlos Rivera",
    });
    expect(byEmail.map((m) => m.id)).toEqual(["sr-a1"]);

    // Name-only fallback: mentions are acceptable (documented behavior).
    const byName = await listRecentMessagesForPerson(USER_A, {
      email: null,
      displayName: "Carlos Rivera",
    });
    expect(byName.map((m) => m.id)).toEqual(["sr-a2"]);
  });
});
