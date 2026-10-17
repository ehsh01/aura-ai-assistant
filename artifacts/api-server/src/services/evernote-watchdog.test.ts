import { afterEach, describe, expect, it } from "vitest";
import {
  checkEvernoteImportWatchdog,
  parseMemAvailableMb,
} from "./evernote-watchdog";

afterEach(() => {
  delete process.env.EVERNOTE_WATCHDOG_DB_CONNECTIONS;
  delete process.env.EVERNOTE_WATCHDOG_MIN_MEM_MB;
});

describe("Evernote import watchdog", () => {
  it("parses Linux MemAvailable", () => {
    expect(
      parseMemAvailableMb("MemTotal:       2048000 kB\nMemAvailable:    153600 kB\n"),
    ).toBe(150);
  });

  it("pauses for DB, RAM, or sibling health pressure and resumes when clear", async () => {
    process.env.EVERNOTE_WATCHDOG_DB_CONNECTIONS = "22";
    process.env.EVERNOTE_WATCHDOG_MIN_MEM_MB = "150";
    const paused = await checkEvernoteImportWatchdog({
      dbConnections: async () => 22,
      availableMemoryMb: async () => 149,
      healthUrls: ["https://sibling.test/health"],
      healthCheck: async () => false,
    });
    expect(paused.safe).toBe(false);
    expect(paused.reasons).toHaveLength(3);

    const resumed = await checkEvernoteImportWatchdog({
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
    const status = await checkEvernoteImportWatchdog({
      dbConnections: async () => null,
      availableMemoryMb: async () => null,
      healthUrls: [],
    });
    expect(status.safe).toBe(true);
  });
});
