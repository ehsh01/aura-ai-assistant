import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cachedEvernoteTitlesSql } from "./item-graph";

describe("graph cached-title PostgreSQL binding", () => {
  let db: PGlite;

  beforeEach(() => {
    db = new PGlite();
  });

  afterEach(async () => {
    await db.close();
  });

  it("executes more than 5,000 titles through one text[] bind parameter", async () => {
    const titles = Array.from(
      { length: 5_501 },
      (_, index) => `Evernote title ${index}`,
    );
    const query = sql`
      WITH evernote_titles AS MATERIALIZED (
        ${cachedEvernoteTitlesSql(titles)}
      )
      SELECT count(*)::int AS count
      FROM evernote_titles
    `;
    const rendered = new PgDialect().sqlToQuery(query);

    expect(rendered.params).toHaveLength(1);
    expect(rendered.params[0]).toEqual(titles);
    await expect(
      db.query<{ count: number }>(rendered.sql, rendered.params),
    ).resolves.toMatchObject({ rows: [{ count: titles.length }] });
  });
});
