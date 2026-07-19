import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { attentionItems, users } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { logger } from "../lib/logger";
import { config } from "../lib/config";
import { smsService } from "./sms";

/**
 * SMS reminder sweep: finds due/almost-due attention items for users who
 * opted in and texts them via Twilio. Two texts per item, each sent exactly
 * once (tracked on the row so retries/restarts never double-send):
 *   - a heads-up when we enter the user's lead window before dueAt
 *   - a "due now" text once dueAt has passed
 *
 * Deliberately does NOT backfill old overdue items on first run / after an
 * outage — a text about something that was due days ago isn't useful, and
 * shipping this against an existing DB full of open attention items must not
 * blast a wall of stale texts. See DUE_GRACE_MS.
 */

/** How far past dueAt we'll still send the "due now" text (covers brief outages/restarts). */
const DUE_GRACE_MS = 20 * 60 * 1000;
/** Upper bound so a user's lead-time setting can't pull in far-future items. */
const MAX_LEAD_MINUTES_QUERY = 24 * 60;

export const SMS_SWEEP_TICK_MS = 60 * 1000;

export type SmsSendPlan = {
  headsUp: boolean;
  dueNow: boolean;
};

/**
 * Pure decision logic for one attention item — exported for unit testing.
 * `leadMinutes` is the user's configured heads-up window.
 */
export function planSmsSendsForItem(
  item: {
    dueAt: Date;
    status: string;
    smsHeadsUpSentAt: Date | null;
    smsDueSentAt: Date | null;
  },
  now: Date,
  leadMinutes: number,
): SmsSendPlan {
  if (item.status !== "open" && item.status !== "seen") {
    return { headsUp: false, dueNow: false };
  }
  const due = item.dueAt.getTime();
  const nowMs = now.getTime();
  const leadMs = leadMinutes * 60_000;

  const headsUp =
    item.smsHeadsUpSentAt == null && nowMs >= due - leadMs && nowMs < due;
  const dueNow =
    item.smsDueSentAt == null && nowMs >= due && nowMs - due <= DUE_GRACE_MS;

  return { headsUp, dueNow };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function headsUpBody(title: string, leadMinutes: number): string {
  const when = leadMinutes >= 60 ? `${Math.round(leadMinutes / 60)}h` : `${leadMinutes}m`;
  return `Recall: coming up in ~${when} — ${truncate(title, 300)} ${config.appPublicUrl}/today`;
}

function dueNowBody(title: string): string {
  return `Recall: due now — ${truncate(title, 300)} ${config.appPublicUrl}/today`;
}

let running = false;

/** One sweep pass across all opted-in users. Safe to call repeatedly/concurrently — serializes itself. */
export async function runSmsReminderSweep(): Promise<{ headsUp: number; dueNow: number }> {
  if (running) return { headsUp: 0, dueNow: 0 };
  running = true;
  let sentHeadsUp = 0;
  let sentDueNow = 0;
  try {
    const now = new Date();
    const earliestDue = new Date(now.getTime() - DUE_GRACE_MS);
    const latestDue = new Date(now.getTime() + MAX_LEAD_MINUTES_QUERY * 60_000);

    const rows = await getDb()
      .select({
        id: attentionItems.id,
        title: attentionItems.title,
        dueAt: attentionItems.dueAt,
        status: attentionItems.status,
        smsHeadsUpSentAt: attentionItems.smsHeadsUpSentAt,
        smsDueSentAt: attentionItems.smsDueSentAt,
        userId: attentionItems.userId,
        phoneNumber: users.phoneNumber,
        smsLeadMinutes: users.smsLeadMinutes,
      })
      .from(attentionItems)
      .innerJoin(users, eq(users.id, attentionItems.userId))
      .where(
        and(
          eq(users.smsRemindersEnabled, true),
          inArray(attentionItems.status, ["open", "seen"]),
          gte(attentionItems.dueAt, earliestDue),
          lte(attentionItems.dueAt, latestDue),
          or(isNull(attentionItems.smsHeadsUpSentAt), isNull(attentionItems.smsDueSentAt)),
        ),
      );

    for (const row of rows) {
      if (!row.phoneNumber) continue;
      const plan = planSmsSendsForItem(
        {
          dueAt: row.dueAt,
          status: row.status,
          smsHeadsUpSentAt: row.smsHeadsUpSentAt,
          smsDueSentAt: row.smsDueSentAt,
        },
        now,
        row.smsLeadMinutes,
      );
      if (!plan.headsUp && !plan.dueNow) continue;

      try {
        if (plan.headsUp) {
          await smsService.sendSms({
            to: row.phoneNumber,
            body: headsUpBody(row.title, row.smsLeadMinutes),
          });
          await getDb()
            .update(attentionItems)
            .set({ smsHeadsUpSentAt: now })
            .where(and(eq(attentionItems.id, row.id), isNull(attentionItems.smsHeadsUpSentAt)));
          sentHeadsUp += 1;
        }
        if (plan.dueNow) {
          await smsService.sendSms({ to: row.phoneNumber, body: dueNowBody(row.title) });
          await getDb()
            .update(attentionItems)
            .set({ smsDueSentAt: now })
            .where(and(eq(attentionItems.id, row.id), isNull(attentionItems.smsDueSentAt)));
          sentDueNow += 1;
        }
      } catch (err) {
        logger.warn(
          { err, attentionItemId: row.id, userId: row.userId },
          "SMS reminder send failed",
        );
      }
    }
    return { headsUp: sentHeadsUp, dueNow: sentDueNow };
  } finally {
    running = false;
  }
}

export class SmsNotConfiguredError extends Error {
  constructor() {
    super("Text reminders aren't set up on the server yet (Twilio isn't configured).");
  }
}

export class NoPhoneNumberError extends Error {
  constructor() {
    super("Add a phone number before sending a test text.");
  }
}

/** Sends an immediate test text to the given phone number — used by the Settings "Send test" button. */
export async function sendTestSmsReminder(phoneNumber: string): Promise<void> {
  if (!smsService.enabled) throw new SmsNotConfiguredError();
  await smsService.sendSms({
    to: phoneNumber,
    body: `Recall: this is a test text. Reminders will look like this — ${config.appPublicUrl}/today`,
  });
}

let timer: NodeJS.Timeout | null = null;

export function startSmsReminderSweep(): void {
  if (timer) return;
  if (!smsService.enabled) {
    logger.info("SMS reminder sweep not started — Twilio is not configured");
    return;
  }
  setTimeout(() => {
    void runSmsReminderSweep();
  }, 15_000);
  timer = setInterval(() => {
    void runSmsReminderSweep();
  }, SMS_SWEEP_TICK_MS);
  timer.unref?.();
  logger.info("SMS reminder sweep started");
}
