import { afterEach, describe, expect, it } from "vitest";
import {
  checkEvernoteImportWatchdog,
  parseMemAvailableMb,
  requiredMemoryMbForBytes,
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

  it("requires max(150MB, 2.5x file size) for attachment work", async () => {
    expect(requiredMemoryMbForBytes(20 * 1024 * 1024)).toBe(150);
    expect(requiredMemoryMbForBytes(100 * 1024 * 1024)).toBe(250);
    const paused = await checkEvernoteImportWatchdog({
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
    const status = await checkEvernoteImportWatchdog({
      dbConnections: async () => 1,
      availableMemoryMb: async () => null,
      healthUrls: [],
      requireMemoryMeasurement: true,
    });
    expect(status.safe).toBe(false);
    expect(status.reasons).toContain("available memory could not be measured");
  });
});
