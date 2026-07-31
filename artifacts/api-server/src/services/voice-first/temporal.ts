/**
 * Relative time resolution for Voice First.
 * Deterministic; no model calls. Product default: morning → 09:00 local.
 */
import { VOICE_FIRST_EVENING_HOUR, VOICE_FIRST_MORNING_HOUR, type TemporalResolution } from "./types";

const MORNING_RE = /\b(tomorrow\s+)?morning\b|\bin\s+the\s+morning\b/i;
const EVENING_RE = /\b(tomorrow\s+)?evening\b|\btonight\b|\bin\s+the\s+evening\b/i;
const TOMORROW_RE = /\btomorrow\b/i;
const TODAY_RE = /\btoday\b/i;
const CLOCK_RE = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i;
const WEEKDAY_RE =
  /\b(this\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** Next occurrence of weekday (0=Sun) on or after `fromIsoDate`. */
export function nextWeekdayOnOrAfter(fromIsoDate: string, weekday: number): string {
  const [y, m, d] = fromIsoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  const current = utc.getUTCDay();
  let delta = (weekday - current + 7) % 7;
  // "this Friday" when today is Friday → today; "next Friday" always +7 if same day.
  return addCalendarDays(fromIsoDate, delta);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Calendar Y-M-D in an IANA timezone for a given Instant. */
export function isoDateInTimezone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fall through
  }
  return date.toISOString().slice(0, 10);
}

/** Add calendar days to a YYYY-MM-DD string (UTC-safe date math). */
export function addCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Build an ISO timestamp for local wall-clock time in `timeZone` on `isoDate`.
 * Uses a short iterative offset correction (no external deps).
 */
export function localWallTimeToIso(
  isoDate: string,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  const guessUtc = Date.parse(`${isoDate}T${pad(hour)}:${pad(minute)}:00.000Z`);
  let utcMs = guessUtc;
  for (let i = 0; i < 3; i++) {
    const asLocal = new Date(utcMs);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(asLocal);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
    const ly = get("year");
    const lm = get("month");
    const ld = get("day");
    const lh = get("hour");
    const lmin = get("minute");
    const [ty, tm, td] = isoDate.split("-").map(Number);
    const target = Date.UTC(ty!, tm! - 1, td!, hour, minute);
    const actual = Date.UTC(ly, lm - 1, ld, lh, lmin);
    const delta = target - actual;
    if (Math.abs(delta) < 30_000) break;
    utcMs += delta;
  }
  return new Date(utcMs).toISOString();
}

function parseClock(text: string): { hour: number; minute: number } | null {
  const m = text.match(CLOCK_RE);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ampm = (m[3] ?? "").toLowerCase().replace(/\./g, "");
  if (!Number.isFinite(hour) || hour < 0 || hour > 23 || minute > 59) return null;
  // Reject bare numbers that are almost certainly not times (e.g. "MRI", "2 docs")
  // unless am/pm or a colon was present, or "at N" preceded.
  const hasAmPm = Boolean(ampm);
  const hasColon = Boolean(m[2]);
  const hasAt = /\bat\s+\d/i.test(text);
  if (!hasAmPm && !hasColon && !hasAt) return null;
  if (hasAmPm) {
    if (hour === 12) hour = ampm.startsWith("a") ? 0 : 12;
    else if (ampm.startsWith("p")) hour += 12;
  }
  if (hour > 23) return null;
  return { hour, minute };
}

/**
 * Resolve relative temporal phrases in utterance text.
 * Prefer explicit clock times; otherwise apply morning/evening defaults.
 */
export function resolveTemporalExpression(
  text: string,
  opts: { now: Date; timeZone: string },
): TemporalResolution {
  const tz = opts.timeZone || "UTC";
  const today = isoDateInTimezone(opts.now, tz);
  let date = today;
  let dayHint: "today" | "tomorrow" | "weekday" | null = null;

  if (TOMORROW_RE.test(text)) {
    date = addCalendarDays(today, 1);
    dayHint = "tomorrow";
  } else if (TODAY_RE.test(text)) {
    dayHint = "today";
  } else {
    const wd = text.match(WEEKDAY_RE);
    if (wd) {
      const name = (wd[2] ?? "").toLowerCase();
      const idx = WEEKDAY_INDEX[name];
      if (idx != null) {
        const wantNext = /\bnext\s+/i.test(wd[0] ?? "");
        let target = nextWeekdayOnOrAfter(today, idx);
        if (wantNext && target === today) target = addCalendarDays(today, 7);
        date = target;
        dayHint = "weekday";
      }
    }
  }

  const clock = parseClock(text);
  if (clock) {
    if (!dayHint && !MORNING_RE.test(text) && !EVENING_RE.test(text)) {
      // Bare clock with no day → assume today (or tomorrow if already past — later).
      date = today;
    }
    const dueAt = localWallTimeToIso(date, clock.hour, clock.minute, tz);
    return {
      dueAt,
      basis: "explicit_clock",
      explanation: `Scheduled for ${date} at ${pad(clock.hour)}:${pad(clock.minute)} (${tz}).`,
    };
  }

  if (MORNING_RE.test(text)) {
    if (!dayHint) date = TOMORROW_RE.test(text) ? addCalendarDays(today, 1) : today;
    // "tomorrow morning" already set date via TOMORROW_RE
    const dueAt = localWallTimeToIso(date, VOICE_FIRST_MORNING_HOUR, 0, tz);
    return {
      dueAt,
      basis: "morning_default",
      explanation: `Using ${VOICE_FIRST_MORNING_HOUR}:00 ${tz} for “morning”.`,
    };
  }

  if (EVENING_RE.test(text)) {
    const dueAt = localWallTimeToIso(date, VOICE_FIRST_EVENING_HOUR, 0, tz);
    return {
      dueAt,
      basis: "evening_default",
      explanation: `Using ${VOICE_FIRST_EVENING_HOUR}:00 ${tz} for “evening/tonight”.`,
    };
  }

  if (dayHint) {
    return {
      dueAt: date,
      basis: "date_only",
      explanation: `Date resolved to ${date}; no clock time — noon local may be applied by the reminder service.`,
    };
  }

  return { dueAt: null, basis: "unresolved", explanation: null };
}
