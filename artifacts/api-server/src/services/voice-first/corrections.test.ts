import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  isoDateInTimezone,
  nextWeekdayOnOrAfter,
  resolveTemporalExpression,
} from "./temporal";

describe("weekday temporal resolution (corrections)", () => {
  const tz = "America/New_York";
  // Thursday 2026-07-30 local (approx) — use a fixed UTC instant.
  const thursday = new Date("2026-07-30T15:00:00Z");

  it("resolves “make that Friday” to the upcoming Friday", () => {
    const today = isoDateInTimezone(thursday, tz);
    const friday = nextWeekdayOnOrAfter(today, 5);
    expect(friday).toBe(addCalendarDays(today, 1)); // Thu → Fri

    const resolved = resolveTemporalExpression("Make that Friday", {
      now: thursday,
      timeZone: tz,
    });
    expect(resolved.dueAt).toBe(friday);
    expect(resolved.basis).toBe("date_only");
  });

  it("resolves “next Friday” to +7 when today is already Friday", () => {
    const fridayInstant = new Date("2026-07-31T15:00:00Z");
    const today = isoDateInTimezone(fridayInstant, tz);
    expect(today).toBe("2026-07-31");
    const resolved = resolveTemporalExpression("next Friday", {
      now: fridayInstant,
      timeZone: tz,
    });
    expect(resolved.dueAt).toBe(addCalendarDays(today, 7));
  });
});

describe("CANCEL regex used by proposal corrections", () => {
  const CANCEL_RE =
    /\b(cancel( that| it| this)?|never ?mind|forget (it|that)|don't (do|make) (it|that)|scratch that)\b/i;

  it("matches common cancel phrases", () => {
    expect(CANCEL_RE.test("cancel that")).toBe(true);
    expect(CANCEL_RE.test("never mind")).toBe(true);
    expect(CANCEL_RE.test("scratch that")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(CANCEL_RE.test("make that Friday")).toBe(false);
  });
});
