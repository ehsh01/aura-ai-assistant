import { afterEach, describe, expect, it } from "vitest";
import {
  isHomeyQuietHours,
  shouldSurfaceHomeyAlert,
} from "./homey-alerts";

describe("homey-alerts filtering", () => {
  const prevTz = process.env.RECALL_TIMEZONE;

  afterEach(() => {
    if (prevTz === undefined) delete process.env.RECALL_TIMEZONE;
    else process.env.RECALL_TIMEZONE = prevTz;
  });

  it("treats emergencies as always surfaced", () => {
    process.env.RECALL_TIMEZONE = "UTC";
    const night = new Date("2026-07-14T03:00:00.000Z");
    expect(shouldSurfaceHomeyAlert("emergency", night)).toBe(true);
  });

  it("filters info during quiet hours", () => {
    process.env.RECALL_TIMEZONE = "UTC";
    const night = new Date("2026-07-14T03:00:00.000Z");
    expect(isHomeyQuietHours(night)).toBe(true);
    expect(shouldSurfaceHomeyAlert("info", night)).toBe(false);
    expect(shouldSurfaceHomeyAlert("warn", night)).toBe(true);
  });

  it("allows info outside quiet hours", () => {
    process.env.RECALL_TIMEZONE = "UTC";
    const day = new Date("2026-07-14T15:00:00.000Z");
    expect(isHomeyQuietHours(day)).toBe(false);
    expect(shouldSurfaceHomeyAlert("info", day)).toBe(true);
  });
});
