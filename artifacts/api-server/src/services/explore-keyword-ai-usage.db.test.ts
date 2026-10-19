import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@workspace/db/schema";

const USER_ID = "11111111-1111-4111-8111-111111111111";
let db: PGlite;
let pgliteDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("../lib/db", () => ({ getDb: () => pgliteDb }));
vi.mock("./retrieval", () => ({
  freeRetrievalTerms: (query: string) =>
    query
      .toLowerCase()
      .split(/\W+/)
      .filter((term) => term.length > 2),
  retrieveRelevantRecords: vi.fn(async () => ({
    records: [],
    usedSemantic: false,
    namedPeople: [],
    tasks: [],
  })),
}));

const { searchExploreForUser } = await import("./explore-search");
const { currentAiFeature, recordAiUsage, withAiFeature } =
  await import("./ai-usage");

describe("Explore free search and explicit AI accounting", () => {
  beforeAll(async () => {
    db = new PGlite();
    pgliteDb = drizzle(db, { schema });
    await db.exec(`
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE captures (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id)
      );
      CREATE TABLE notebooks (
        id varchar(64) PRIMARY KEY,
        name varchar(500) NOT NULL
      );
      CREATE TABLE notes (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        notebook_id varchar(64),
        title varchar(500) NOT NULL,
        preview text NOT NULL DEFAULT '',
        tags jsonb NOT NULL DEFAULT '[]'::jsonb,
        search_tsv tsvector,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE connectors (
        id varchar(64) PRIMARY KEY,
        type varchar(64) NOT NULL
      );
      CREATE TABLE source_records (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        connector_id varchar(64) NOT NULL REFERENCES connectors(id),
        record_type varchar(64) NOT NULL,
        record_title text,
        record_text text,
        record_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        source_url text,
        source_created_at timestamptz,
        source_updated_at timestamptz,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE ai_usage (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES users(id),
        feature varchar(64) NOT NULL,
        provider varchar(32),
        model varchar(96) NOT NULL,
        background boolean NOT NULL DEFAULT false,
        prompt_tokens integer NOT NULL DEFAULT 0,
        completion_tokens integer NOT NULL DEFAULT 0,
        total_tokens integer NOT NULL DEFAULT 0,
        characters integer NOT NULL DEFAULT 0,
        seconds integer NOT NULL DEFAULT 0,
        cost_micros bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO users (id) VALUES ('${USER_ID}');
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
    await db.exec(`
      INSERT INTO items (id, user_id, kind, title, body_text, tags, notebook)
      VALUES (
        'item-permit',
        '${USER_ID}',
        'note',
        'Permit revision',
        'City approval and next steps',
        '["permits"]'::jsonb,
        'House Projects'
      );
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("returns Enter keyword results without inserting ai_usage", async () => {
    const results = await searchExploreForUser(USER_ID, "permit", 12);
    const usage = await db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM ai_usage",
    );

    expect(results.map((item) => item.itemId)).toContain("item-permit");
    expect(usage.rows[0]?.count).toBe("0");
  });

  it("inserts exactly one ask_query row for one mocked Ask AI model call", async () => {
    const mockedLlm = vi.fn(async () => {
      const context = currentAiFeature();
      await recordAiUsage(
        {
          feature: context.feature,
          userId: context.userId,
          model: "gpt-4.1-mini",
          promptTokens: 12,
          completionTokens: 5,
        },
        { strict: true },
      );
      return { answer: "Permit approved." };
    });
    await withAiFeature({ feature: "ask_query", userId: USER_ID }, mockedLlm);

    const usage = await db.query<{ feature: string; count: string }>(
      "SELECT feature, count(*)::text AS count FROM ai_usage GROUP BY feature",
    );
    expect(mockedLlm).toHaveBeenCalledTimes(1);
    expect(usage.rows).toEqual([{ feature: "ask_query", count: "1" }]);
  });

  it("records one voice Ask and one voice TTS row without storing text", async () => {
    await withAiFeature({ feature: "voice_ask", userId: USER_ID }, async () => {
      const context = currentAiFeature();
      await recordAiUsage(
        {
          feature: context.feature,
          userId: context.userId,
          provider: "openai",
          model: "gpt-4.1-mini",
          promptTokens: 120,
          completionTokens: 24,
        },
        { strict: true },
      );
    });
    await recordAiUsage(
      {
        feature: "voice_tts",
        userId: USER_ID,
        provider: "openai",
        model: "tts-1",
        characters: 84,
        costMicros: 84 * 15,
      },
      { strict: true },
    );

    const usage = await db.query<{
      feature: string;
      provider: string;
      model: string;
      characters: number;
      seconds: number;
    }>(`
      SELECT feature, provider, model, characters, seconds
      FROM ai_usage
      WHERE feature IN ('voice_ask', 'voice_tts')
      ORDER BY feature
    `);
    expect(usage.rows).toEqual([
      {
        feature: "voice_ask",
        provider: "openai",
        model: "gpt-4.1-mini",
        characters: 0,
        seconds: 0,
      },
      {
        feature: "voice_tts",
        provider: "openai",
        model: "tts-1",
        characters: 84,
        seconds: 0,
      },
    ]);

    const columns = await db.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'ai_usage'
    `);
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining(["transcript", "answer", "text"]),
    );
  });
});
