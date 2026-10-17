import { afterEach, describe, expect, it } from "vitest";
import {
  isEvernoteAutoFullImportEnabled,
  isEvernoteFullReconcileEnabled,
  isEvernoteIncrementalSyncEnabled,
  isEvernoteNightWindow,
  isEvernoteSchedulerEnabled,
  isHourInWindow,
} from "./evernote-runtime-policy";

const ENV_NAMES = [
  "EVERNOTE_SYNC_ENABLED",
  "EVERNOTE_INCREMENTAL_SYNC_ENABLED",
  "EVERNOTE_FULL_RECONCILE_ENABLED",
  "EVERNOTE_AUTO_FULL_IMPORT",
  "EVERNOTE_NIGHT_WINDOW_START_HOUR",
  "EVERNOTE_NIGHT_WINDOW_END_HOUR",
  "EVERNOTE_NIGHT_WINDOW_TIMEZONE",
] as const;

afterEach(() => {
  for (const name of ENV_NAMES) delete process.env[name];
});

describe("Evernote runtime policy", () => {
  it("uses strict feature-flag parsing and keeps auto-full off by default", () => {
    expect(isEvernoteSchedulerEnabled()).toBe(true);
    expect(isEvernoteIncrementalSyncEnabled()).toBe(true);
    expect(isEvernoteFullReconcileEnabled()).toBe(true);
    expect(isEvernoteAutoFullImportEnabled()).toBe(false);

    process.env.EVERNOTE_SYNC_ENABLED = "banana";
    process.env.EVERNOTE_INCREMENTAL_SYNC_ENABLED = "off";
    process.env.EVERNOTE_FULL_RECONCILE_ENABLED = "YES";
    process.env.EVERNOTE_AUTO_FULL_IMPORT = "on";
    expect(isEvernoteSchedulerEnabled()).toBe(false);
    expect(isEvernoteIncrementalSyncEnabled()).toBe(false);
    expect(isEvernoteFullReconcileEnabled()).toBe(true);
    expect(isEvernoteAutoFullImportEnabled()).toBe(true);
  });

  it("defaults to 1–5 AM America/New_York", () => {
    expect(isEvernoteNightWindow(new Date("2026-10-17T05:30:00Z"))).toBe(true);
    expect(isEvernoteNightWindow(new Date("2026-10-17T09:00:00Z"))).toBe(false);
  });

  it("supports windows that cross midnight", () => {
    expect(isHourInWindow(23, 22, 3)).toBe(true);
    expect(isHourInWindow(2, 22, 3)).toBe(true);
    expect(isHourInWindow(12, 22, 3)).toBe(false);
  });
});
