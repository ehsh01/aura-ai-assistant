import { describe, expect, it } from "vitest";
import { findExpiringWarranties } from "./warranties";

describe("findExpiringWarranties", () => {
  it("includes warranties within the upcoming window", () => {
    const items = [
      { id: "w1", title: "Roof", expiresAt: "2026-08-01", subjectName: "Home" },
      { id: "w2", title: "Tire", expiresAt: "2027-12-01", subjectName: "Porsche" },
      { id: "w3", title: "No date", expiresAt: null },
    ];
    const found = findExpiringWarranties(items, {
      todayIso: "2026-07-13",
      upcomingDays: 90,
      pastGraceDays: 14,
    });
    expect(found.map((w) => w.id)).toEqual(["w1"]);
    expect(found[0]?.daysUntil).toBe(19);
  });

  it("includes recently expired warranties within grace", () => {
    const found = findExpiringWarranties(
      [{ id: "w1", title: "Battery", expiresAt: "2026-07-10" }],
      { todayIso: "2026-07-13", upcomingDays: 90, pastGraceDays: 14 },
    );
    expect(found[0]).toEqual(
      expect.objectContaining({ id: "w1", daysUntil: -3 }),
    );
  });
});
