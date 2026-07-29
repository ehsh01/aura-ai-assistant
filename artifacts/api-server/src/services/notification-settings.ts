import { eq } from "drizzle-orm";
import { users } from "@workspace/db/schema";
import { getDb } from "../lib/db";

export type NotificationSettingsDto = {
  phoneNumber: string | null;
  smsRemindersEnabled: boolean;
  smsLeadMinutes: number;
  timezone: string | null;
  morningBriefingEnabled: boolean;
  morningBriefingTime: string;
  eveningCheckinEnabled: boolean;
  eveningCheckinTime: string;
  quietHoursStart: string;
  quietHoursEnd: string;
};

const TIME_HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class InvalidTimeError extends Error {
  constructor(field: string) {
    super(`Invalid time for ${field} — use 24-hour HH:MM (e.g. 07:30).`);
  }
}

export class InvalidTimezoneError extends Error {
  constructor() {
    super("Invalid timezone — use an IANA name like America/New_York.");
  }
}

function assertValidTime(value: string, field: string): void {
  if (!TIME_HHMM_RE.test(value)) throw new InvalidTimeError(field);
}

function assertValidTimezone(value: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw new InvalidTimezoneError();
  }
}

/** Sensible bounds for the "heads-up before due" lead time. */
export const SMS_LEAD_MINUTES_MIN = 5;
export const SMS_LEAD_MINUTES_MAX = 24 * 60;

/**
 * Normalize a user-typed phone number to E.164 for Twilio. US/Canada-only
 * shorthand for now: bare 10-digit numbers get +1; 11 digits starting with 1
 * get a leading +; anything already starting with + is passed through after
 * a light sanity check. Returns null when the input can't be made valid.
 */
export function normalizePhoneNumberE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Basic display formatting for a stored E.164 US number, e.g. +15551234567 -> (555) 123-4567. */
export function formatPhoneNumberForDisplay(e164: string | null): string {
  if (!e164) return "";
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (match) return `(${match[1]}) ${match[2]}-${match[3]}`;
  return e164;
}

export function clampLeadMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 30;
  return Math.min(SMS_LEAD_MINUTES_MAX, Math.max(SMS_LEAD_MINUTES_MIN, Math.round(minutes)));
}

const BRIEFING_DEFAULTS = {
  timezone: null,
  morningBriefingEnabled: false,
  morningBriefingTime: "07:30",
  eveningCheckinEnabled: false,
  eveningCheckinTime: "17:30",
  quietHoursStart: "21:00",
  quietHoursEnd: "08:00",
} as const;

function toDto(row: {
  phoneNumber: string | null;
  smsRemindersEnabled: boolean;
  smsLeadMinutes: number;
  timezone: string | null;
  morningBriefingEnabled: boolean;
  morningBriefingTime: string;
  eveningCheckinEnabled: boolean;
  eveningCheckinTime: string;
  quietHoursStart: string;
  quietHoursEnd: string;
}): NotificationSettingsDto {
  return {
    phoneNumber: row.phoneNumber,
    smsRemindersEnabled: row.smsRemindersEnabled,
    smsLeadMinutes: row.smsLeadMinutes,
    timezone: row.timezone,
    morningBriefingEnabled: row.morningBriefingEnabled,
    morningBriefingTime: row.morningBriefingTime,
    eveningCheckinEnabled: row.eveningCheckinEnabled,
    eveningCheckinTime: row.eveningCheckinTime,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
  };
}

const SETTINGS_SELECT = {
  phoneNumber: users.phoneNumber,
  smsRemindersEnabled: users.smsRemindersEnabled,
  smsLeadMinutes: users.smsLeadMinutes,
  timezone: users.timezone,
  morningBriefingEnabled: users.morningBriefingEnabled,
  morningBriefingTime: users.morningBriefingTime,
  eveningCheckinEnabled: users.eveningCheckinEnabled,
  eveningCheckinTime: users.eveningCheckinTime,
  quietHoursStart: users.quietHoursStart,
  quietHoursEnd: users.quietHoursEnd,
} as const;

export async function getNotificationSettingsForUser(
  userId: string,
): Promise<NotificationSettingsDto> {
  const [row] = await getDb()
    .select(SETTINGS_SELECT)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return toDto(
    row ?? {
      phoneNumber: null,
      smsRemindersEnabled: false,
      smsLeadMinutes: 30,
      ...BRIEFING_DEFAULTS,
    },
  );
}

export class InvalidPhoneNumberError extends Error {
  constructor() {
    super("Enter a valid US phone number (10 digits).");
  }
}

/** Full briefing prefs — consumed by the morning briefing, /checkin, and the SMS sweep. */
export type BriefingPrefs = {
  timezone: string | null;
  phoneNumber: string | null;
  morningBriefingEnabled: boolean;
  morningBriefingTime: string;
  eveningCheckinEnabled: boolean;
  eveningCheckinTime: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  lastMorningBriefingOn: string | null;
  lastEveningCheckinOn: string | null;
};

export async function getBriefingPrefsForUser(userId: string): Promise<BriefingPrefs> {
  const [row] = await getDb()
    .select({
      timezone: users.timezone,
      phoneNumber: users.phoneNumber,
      morningBriefingEnabled: users.morningBriefingEnabled,
      morningBriefingTime: users.morningBriefingTime,
      eveningCheckinEnabled: users.eveningCheckinEnabled,
      eveningCheckinTime: users.eveningCheckinTime,
      quietHoursStart: users.quietHoursStart,
      quietHoursEnd: users.quietHoursEnd,
      lastMorningBriefingOn: users.lastMorningBriefingOn,
      lastEveningCheckinOn: users.lastEveningCheckinOn,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return (
    row ?? {
      timezone: null,
      phoneNumber: null,
      morningBriefingEnabled: false,
      morningBriefingTime: "07:30",
      eveningCheckinEnabled: false,
      eveningCheckinTime: "17:30",
      quietHoursStart: "21:00",
      quietHoursEnd: "08:00",
      lastMorningBriefingOn: null,
      lastEveningCheckinOn: null,
    }
  );
}

export async function updateNotificationSettingsForUser(
  userId: string,
  input: {
    phoneNumber?: string | null;
    smsRemindersEnabled?: boolean;
    smsLeadMinutes?: number;
    timezone?: string | null;
    morningBriefingEnabled?: boolean;
    morningBriefingTime?: string;
    eveningCheckinEnabled?: boolean;
    eveningCheckinTime?: string;
    quietHoursStart?: string;
    quietHoursEnd?: string;
  },
): Promise<NotificationSettingsDto> {
  const patch: Partial<typeof users.$inferInsert> = {};

  if (input.phoneNumber !== undefined) {
    if (input.phoneNumber === null || input.phoneNumber.trim() === "") {
      patch.phoneNumber = null;
    } else {
      const normalized = normalizePhoneNumberE164(input.phoneNumber);
      if (!normalized) throw new InvalidPhoneNumberError();
      patch.phoneNumber = normalized;
    }
  }
  if (input.smsRemindersEnabled !== undefined) {
    patch.smsRemindersEnabled = input.smsRemindersEnabled;
  }
  if (input.smsLeadMinutes !== undefined) {
    patch.smsLeadMinutes = clampLeadMinutes(input.smsLeadMinutes);
  }
  if (input.timezone !== undefined) {
    const tz = input.timezone?.trim() || null;
    if (tz) assertValidTimezone(tz);
    patch.timezone = tz;
  }
  if (input.morningBriefingEnabled !== undefined) {
    patch.morningBriefingEnabled = input.morningBriefingEnabled;
  }
  if (input.morningBriefingTime !== undefined) {
    assertValidTime(input.morningBriefingTime, "morning briefing");
    patch.morningBriefingTime = input.morningBriefingTime;
  }
  if (input.eveningCheckinEnabled !== undefined) {
    patch.eveningCheckinEnabled = input.eveningCheckinEnabled;
  }
  if (input.eveningCheckinTime !== undefined) {
    assertValidTime(input.eveningCheckinTime, "evening check-in");
    patch.eveningCheckinTime = input.eveningCheckinTime;
  }
  if (input.quietHoursStart !== undefined) {
    assertValidTime(input.quietHoursStart, "quiet hours start");
    patch.quietHoursStart = input.quietHoursStart;
  }
  if (input.quietHoursEnd !== undefined) {
    assertValidTime(input.quietHoursEnd, "quiet hours end");
    patch.quietHoursEnd = input.quietHoursEnd;
  }

  const [row] = await getDb()
    .update(users)
    .set(patch)
    .where(eq(users.id, userId))
    .returning(SETTINGS_SELECT);
  return toDto(row!);
}
