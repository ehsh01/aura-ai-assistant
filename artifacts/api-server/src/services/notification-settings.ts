import { eq } from "drizzle-orm";
import { users } from "@workspace/db/schema";
import { getDb } from "../lib/db";

export type NotificationSettingsDto = {
  phoneNumber: string | null;
  smsRemindersEnabled: boolean;
  smsLeadMinutes: number;
};

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

function toDto(row: {
  phoneNumber: string | null;
  smsRemindersEnabled: boolean;
  smsLeadMinutes: number;
}): NotificationSettingsDto {
  return {
    phoneNumber: row.phoneNumber,
    smsRemindersEnabled: row.smsRemindersEnabled,
    smsLeadMinutes: row.smsLeadMinutes,
  };
}

export async function getNotificationSettingsForUser(
  userId: string,
): Promise<NotificationSettingsDto> {
  const [row] = await getDb()
    .select({
      phoneNumber: users.phoneNumber,
      smsRemindersEnabled: users.smsRemindersEnabled,
      smsLeadMinutes: users.smsLeadMinutes,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return toDto(row ?? { phoneNumber: null, smsRemindersEnabled: false, smsLeadMinutes: 30 });
}

export class InvalidPhoneNumberError extends Error {
  constructor() {
    super("Enter a valid US phone number (10 digits).");
  }
}

export async function updateNotificationSettingsForUser(
  userId: string,
  input: {
    phoneNumber?: string | null;
    smsRemindersEnabled?: boolean;
    smsLeadMinutes?: number;
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

  const [row] = await getDb()
    .update(users)
    .set(patch)
    .where(eq(users.id, userId))
    .returning({
      phoneNumber: users.phoneNumber,
      smsRemindersEnabled: users.smsRemindersEnabled,
      smsLeadMinutes: users.smsLeadMinutes,
    });
  return toDto(row!);
}
