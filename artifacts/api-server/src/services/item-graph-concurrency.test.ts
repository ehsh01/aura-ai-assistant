import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  return {
    reset() {
      active = 0;
      maxActive = 0;
      calls = 0;
    },
    state() {
      return { active, maxActive, calls };
    },
    async execute(query: SQL) {
      active += 1;
      calls += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        const text = new PgDialect().sqlToQuery(query).sql;
        if (text.includes("WITH evernote_rows AS MATERIALIZED")) {
          return { rows: [{ title_norm: "roof warranty" }] };
        }
        if (text.includes("SELECT source_key, row_count")) {
          return {
            rows: [
              "items",
              "notes",
              "evernote_note",
              "gmail_message",
              "drive_file",
              "calendar_event",
              "finance_transaction",
              "flipperforce_project",
              "homey_device",
              "google_contact",
              "memories",
              "tasks",
            ].map((source_key) => ({ source_key, row_count: 100 })),
          };
        }
        return { rows: [] };
      } finally {
        active -= 1;
      }
    },
  };
});

vi.mock("../lib/db", () => ({
  getDb: () => ({
    transaction: async (
      callback: (tx: { execute: typeof mocks.execute }) => Promise<unknown>,
    ) => callback({ execute: mocks.execute }),
  }),
}));

import {
  clearGraphCachesForTest,
  getKnowledgeGraphForUser,
  parseGraphQuery,
} from "./item-graph";

describe("graph transaction query scheduling", () => {
  beforeEach(() => {
    mocks.reset();
    clearGraphCachesForTest();
  });

  it("never overlaps queries on the transaction's single pg client", async () => {
    await getKnowledgeGraphForUser(
      "11111111-1111-4111-8111-111111111111",
      parseGraphQuery({ limit: "100" }),
    );

    expect(mocks.state().calls).toBeGreaterThanOrEqual(9);
    expect(mocks.state().maxActive).toBe(1);
  });
});
