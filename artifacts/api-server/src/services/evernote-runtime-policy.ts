import { isEnabled } from "../lib/feature-flags";

function envHour(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 && value <= 23
    ? value
    : fallback;
}

export function evernoteNightWindowConfig(): {
  startHour: number;
  endHour: number;
  timeZone: string;
} {
  return {
    startHour: envHour("EVERNOTE_NIGHT_WINDOW_START_HOUR", 1),
    endHour: envHour("EVERNOTE_NIGHT_WINDOW_END_HOUR", 5),
    timeZone:
      process.env.EVERNOTE_NIGHT_WINDOW_TIMEZONE?.trim() ||
      "America/New_York",
  };
}

export function hourInTimeZone(now: Date, timeZone: string): number {
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone,
    })
      .formatToParts(now)
      .find((part) => part.type === "hour")?.value;
    const parsed = Number(hour);
    return Number.isInteger(parsed) ? parsed : now.getUTCHours();
  } catch {
    return hourInTimeZone(now, "America/New_York");
  }
}

export function isHourInWindow(
  hour: number,
  startHour: number,
  endHour: number,
): boolean {
  if (startHour === endHour) return true;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

export function isEvernoteNightWindow(now = new Date()): boolean {
  const config = evernoteNightWindowConfig();
  return isHourInWindow(
    hourInTimeZone(now, config.timeZone),
    config.startHour,
    config.endHour,
  );
}

export function isEvernoteSchedulerEnabled(): boolean {
  return isEnabled("EVERNOTE_SYNC_ENABLED", true);
}

export function isEvernoteIncrementalSyncEnabled(): boolean {
  return isEnabled("EVERNOTE_INCREMENTAL_SYNC_ENABLED", true);
}

export function isEvernoteFullReconcileEnabled(): boolean {
  return isEnabled("EVERNOTE_FULL_RECONCILE_ENABLED", true);
}

export function isEvernoteAutoFullImportEnabled(): boolean {
  return isEnabled("EVERNOTE_AUTO_FULL_IMPORT", false);
}
