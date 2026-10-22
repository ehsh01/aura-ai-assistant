import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  getDb: () => ({ execute: mocks.execute }),
}));

import {
  checkEvernoteImportWatchdog,
  parseMemAvailableMb,
  requiredMemoryMbForBytes,
  watchdogDbConnectionLimit,
  watchdogMinMemoryMb,
} from "./evernote-watchdog";

function checkWatchdog(
  deps: Parameters<typeof checkEvernoteImportWatchdog>[0] = {},
) {
  return checkEvernoteImportWatchdog({
    selectOneLatencyMs: async () => 1,
    recallActiveDbSessions: async () => 0,
    ...deps,
  });
}

beforeEach(() => {
  mocks.execute.mockReset();
});

afterEach(() => {
  delete process.env.EVERNOTE_WATCHDOG_DB_CONNECTIONS;
  delete process.env.EVERNOTE_WATCHDOG_MIN_MEM_MB;
});

describe("Evernote import watchdog", () => {
  it("defaults the minimum available memory floor to 200MB", () => {
    expect(watchdogMinMemoryMb()).toBe(200);
  });

  it("defaults the per-database client connection limit to 15", () => {
    expect(watchdogDbConnectionLimit()).toBe(15);
  });

  it("counts only client backends connected to the current database", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ count: 7 }] });

    const status = await checkWatchdog({
      availableMemoryMb: async () => 1_000,
      healthUrls: [],
    });

    expect(status.dbConnections).toBe(7);
    expect(mocks.execute).toHaveBeenCalledOnce();
    const query = mocks.execute.mock.calls[0]?.[0] as SQL;
    const renderedSql = new PgDialect()
      .sqlToQuery(query)
      .sql.replace(/\s+/g, " ")
      .trim();
    expect(renderedSql).toContain(
      "FROM pg_stat_activity WHERE backend_type = 'client backend' AND datname = current_database()",
    );
  });

  it("pauses at or above the DB connection limit and passes below it", async () => {
    process.env.EVERNOTE_WATCHDOG_DB_CONNECTIONS = "15";
    const checkConnections = (dbConnections: number) =>
      checkWatchdog({
        dbConnections: async () => dbConnections,
        availableMemoryMb: async () => 1_000,
        healthUrls: [],
      });

    await expect(checkConnections(14)).resolves.toMatchObject({
      safe: true,
      reasons: [],
    });
    await expect(checkConnections(15)).resolves.toMatchObject({
      safe: false,
      reasons: ["recall DB client connections 15 >= 15"],
    });
    await expect(checkConnections(16)).resolves.toMatchObject({
      safe: false,
      reasons: ["recall DB client connections 16 >= 15"],
    });
  });

  it("pauses on slow DB probes and sustained active Recall sessions", async () => {
    const pressure = { sinceMs: null as number | null };
    const first = await checkEvernoteImportWatchdog({
      dbConnections: async () => 1,
      selectOneLatencyMs: async () => 251,
      recallActiveDbSessions: async () => 2,
      availableMemoryMb: async () => 1_000,
      healthUrls: [],
      nowMs: () => 1_000,
      activeSessionPressureState: pressure,
    });
    expect(first.reasons).toContain("SELECT 1 latency 251.0 ms > 250 ms");
    expect(first.reasons.some((reason) => reason.includes("2 >= 2"))).toBe(
      false,
    );

    const status = await checkEvernoteImportWatchdog({
      dbConnections: async () => 1,
      selectOneLatencyMs: async () => 1,
      recallActiveDbSessions: async () => 2,
      availableMemoryMb: async () => 1_000,
      healthUrls: [],
      nowMs: () => 31_000,
      activeSessionPressureState: pressure,
    });
    expect(status.safe).toBe(false);
    expect(status.reasons.some((reason) => reason.includes("2 >= 2"))).toBe(
      true,
    );
  });

  it("parses Linux MemAvailable", () => {
    expect(
      parseMemAvailableMb("MemTotal:       2048000 kB\nMemAvailable:    153600 kB\n"),
    ).toBe(150);
  });

  it("pauses for DB, RAM, or sibling health pressure and resumes when clear", async () => {
    process.env.EVERNOTE_WATCHDOG_DB_CONNECTIONS = "22";
    process.env.EVERNOTE_WATCHDOG_MIN_MEM_MB = "150";
    const paused = await checkWatchdog({
      dbConnections: async () => 22,
      availableMemoryMb: async () => 149,
      healthUrls: ["https://sibling.test/health"],
      healthCheck: async () => false,
    });
    expect(paused.safe).toBe(false);
    expect(paused.reasons).toHaveLength(3);

    const resumed = await checkWatchdog({
      dbConnections: async () => 21,
      availableMemoryMb: async () => 151,
      healthUrls: ["https://sibling.test/health"],
      healthCheck: async () => true,
    });
    expect(resumed).toMatchObject({
      safe: true,
      reasons: [],
      unhealthyUrls: [],
    });
  });

  it("keeps working when pg_stat_activity or procfs is unavailable", async () => {
    const status = await checkWatchdog({
      dbConnections: async () => null,
      availableMemoryMb: async () => null,
      healthUrls: [],
    });
    expect(status.safe).toBe(true);
  });

  it("requires max(200MB, 2.5x file size) for attachment work", async () => {
    expect(requiredMemoryMbForBytes(20 * 1024 * 1024)).toBe(200);
    expect(requiredMemoryMbForBytes(100 * 1024 * 1024)).toBe(250);
    const paused = await checkWatchdog({
      dbConnections: async () => 1,
      availableMemoryMb: async () => 199,
      healthUrls: [],
      minimumMemoryMb: 200,
      requireMemoryMeasurement: true,
    });
    expect(paused.safe).toBe(false);
    expect(paused.reasons[0]).toContain("199.0 MB < 200.0 MB");
  });

  it("fails closed when attachment memory cannot be measured", async () => {
    const status = await checkWatchdog({
      dbConnections: async () => 1,
      availableMemoryMb: async () => null,
      healthUrls: [],
      requireMemoryMeasurement: true,
    });
    expect(status.safe).toBe(false);
    expect(status.reasons).toContain("available memory could not be measured");
  });
});
