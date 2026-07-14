import { describe, expect, it } from "vitest";
import {
  filterActiveMemoryRows,
  isMemoryActiveForRetrieval,
  normalizeMemoryStatus,
  parseExpiresAt,
} from "./life-memory";

describe("life memory lifecycle helpers", () => {
  it("normalizes status values", () => {
    expect(normalizeMemoryStatus("active")).toBe("active");
    expect(normalizeMemoryStatus("SUPERSEDED")).toBe("superseded");
    expect(normalizeMemoryStatus("nope")).toBe("active");
  });

  it("treats past expiresAt as inactive even when status is active", () => {
    const now = new Date("2026-07-14T12:00:00Z");
    expect(
      isMemoryActiveForRetrieval(
        { status: "active", expiresAt: new Date("2026-07-13T12:00:00Z") },
        now,
      ),
    ).toBe(false);
    expect(
      isMemoryActiveForRetrieval(
        { status: "active", expiresAt: new Date("2026-07-15T12:00:00Z") },
        now,
      ),
    ).toBe(true);
    expect(
      isMemoryActiveForRetrieval({ status: "superseded", expiresAt: null }, now),
    ).toBe(false);
  });

  it("filters inactive rows for shared context", () => {
    const now = new Date("2026-07-14T12:00:00Z");
    const kept = filterActiveMemoryRows(
      [
        { status: "active", expiresAt: null },
        { status: "archived", expiresAt: null },
        { status: "active", expiresAt: new Date("2026-01-01T00:00:00Z") },
      ],
      now,
    );
    expect(kept).toHaveLength(1);
  });

  it("parses expiresAt", () => {
    expect(parseExpiresAt(null)).toBeNull();
    expect(parseExpiresAt("2026-08-01T00:00:00.000Z")?.toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });
});
