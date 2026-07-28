import { describe, expect, it } from "vitest";
import { buildThreadExcerpt } from "./waiting-follow-up";

describe("buildThreadExcerpt", () => {
  it("quotes only what is in the thread records", () => {
    const excerpt = buildThreadExcerpt([
      {
        recordTitle: "Permit docs",
        recordText:
          "From: Carlos <carlos@acmepermits.com>\nsender_name: Carlos\nsender_email: carlos@acmepermits.com\nSubject: Permit docs\nI'll have the as-built documents ready by Friday.",
        sourceCreatedAt: new Date("2026-07-20T14:00:00Z"),
      },
    ]);
    expect(excerpt).toContain("2026-07-20");
    expect(excerpt).toContain("Carlos");
    expect(excerpt).toContain("as-built documents ready by Friday");
  });

  it("caps the number of messages and total length", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      recordTitle: `Msg ${i}`,
      recordText: `From: Carlos\nbody ${i} ${"x".repeat(500)}`,
      sourceCreatedAt: new Date("2026-07-20T14:00:00Z"),
    }));
    const excerpt = buildThreadExcerpt(many);
    const messageCount = (excerpt.match(/--- /g) ?? []).length;
    expect(messageCount).toBeLessThanOrEqual(6);
    expect(excerpt.length).toBeLessThanOrEqual(4200);
  });

  it("skips empty bodies and returns empty string when nothing usable", () => {
    expect(
      buildThreadExcerpt([
        { recordTitle: "Empty", recordText: "", sourceCreatedAt: null },
      ]),
    ).toBe("");
  });
});
