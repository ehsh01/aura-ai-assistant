import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;

describe("0041 voice usage metadata migration", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE ai_usage (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid,
        feature varchar(64) NOT NULL,
        model varchar(96) NOT NULL,
        background boolean NOT NULL DEFAULT false,
        prompt_tokens integer NOT NULL DEFAULT 0,
        completion_tokens integer NOT NULL DEFAULT 0,
        total_tokens integer NOT NULL DEFAULT 0,
        cost_micros bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO ai_usage (feature, model, total_tokens, cost_micros)
      VALUES ('ask_query', 'gpt-4.1-mini', 42, 17);
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  it("is additive, idempotent, and preserves legacy usage", async () => {
    const migration = await readFile(
      new URL(
        "../../../../lib/db/migrations/0041_ai_usage_voice_metadata.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);

    const result = await db.query<{
      feature: string;
      model: string;
      total_tokens: number;
      cost_micros: string;
      provider: string | null;
      characters: number;
      seconds: number;
    }>(`
      SELECT feature, model, total_tokens, cost_micros::text,
             provider, characters, seconds
      FROM ai_usage
    `);
    expect(result.rows).toEqual([
      {
        feature: "ask_query",
        model: "gpt-4.1-mini",
        total_tokens: 42,
        cost_micros: "17",
        provider: null,
        characters: 0,
        seconds: 0,
      },
    ]);
  });
});
