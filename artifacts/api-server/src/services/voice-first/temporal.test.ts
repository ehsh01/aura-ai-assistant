import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  isoDateInTimezone,
  localWallTimeToIso,
  resolveTemporalExpression,
} from "./temporal";
import { VOICE_FIRST_MORNING_HOUR } from "./types";

describe("resolveTemporalExpression", () => {
  const now = new Date("2026-07-30T15:00:00Z"); // afternoon UTC
  const tz = "America/New_York";

  it("resolves tomorrow morning to 09:00 local (product default)", () => {
    const result = resolveTemporalExpression(
      "Remind me tomorrow morning to call John about the MRI",
      { now, timeZone: tz },
    );
    expect(result.basis).toBe("morning_default");
    expect(result.dueAt).toBeTruthy();
    // 2026-07-31 09:00 America/New_York = 13:00 UTC (EDT)
    expect(result.dueAt).toBe(localWallTimeToIso("2026-07-31", VOICE_FIRST_MORNING_HOUR, 0, tz));
    expect(result.explanation).toMatch(/09:00|9:00/);
  });

  it("prefers an explicit clock over the morning default", () => {
    const result = resolveTemporalExpression("Remind me tomorrow at 2:30 PM to call John", {
      now,
      timeZone: tz,
    });
    expect(result.basis).toBe("explicit_clock");
    expect(result.dueAt).toBe(localWallTimeToIso("2026-07-31", 14, 30, tz));
  });

  it("leaves non-temporal text unresolved", () => {
    const result = resolveTemporalExpression("What did John say about the MRI?", {
      now,
      timeZone: tz,
    });
    expect(result).toEqual({ dueAt: null, basis: "unresolved", explanation: null });
  });

  it("resolves tonight to evening default", () => {
    const result = resolveTemporalExpression("Remind me tonight to take meds", {
      now,
      timeZone: tz,
    });
    expect(result.basis).toBe("evening_default");
    expect(result.dueAt).toBe(localWallTimeToIso(isoDateInTimezone(now, tz), 17, 0, tz));
  });
});

describe("date helpers", () => {
  it("adds calendar days without timezone drift", () => {
    expect(addCalendarDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("formats the local calendar date in the given timezone", () => {
    // 2026-07-30 15:00 UTC = 11:00 AM EDT
    expect(isoDateInTimezone(new Date("2026-07-30T15:00:00Z"), "America/New_York")).toBe(
      "2026-07-30",
    );
  });
});
