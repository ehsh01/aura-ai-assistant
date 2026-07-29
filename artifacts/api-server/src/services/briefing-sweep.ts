import { and, eq, inArray, isNull, ne, or, sql, type AnyColumn } from "drizzle-orm";
import { attentionItems, users, waitingItems } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { logger } from "../lib/logger";
import { config } from "../lib/config";
import { smsService } from "./sms";
import { writeAuditLog } from "./audit";
import { decideBriefingSend, isoDateInTimezone } from "./briefing";
import { recallTimezone } from "./query-utils";

/**
 * Daily briefing sweep (Phase 4): once a day per opted-in user, text a
 * counts-only nudge (morning briefing / evening check-in) at their configured
 * local time. Source content never leaves the app — the text is counts + link.
 *
 * Idempotency: the `last_*_on` user columns store the user-local send date;
 * the marker update is conditional (only written when not already today), so
 * retries, restarts, and overlapping ticks can never double-send. If a send
 * fails, the marker is not written and the next tick retries — but only
 * within the same local day.
 */

export const BRIEFING_SWEEP_TICK_MS = 60 * 1000;

type SweepUser = {
  id: string;
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

/** Counts-only signals for the SMS body. All dates evaluated in the user's timezone. */
async function countBriefingSignals(
  userId: string,
  tz: string,
  today: string,
): Promise<{ deadlinesThisWeek: number; waitingDue: number; dueTodayOrOverdue: number; tomorrow: number }> {
  const db = getDb();
  const weekEnd = isoDateInTimezone(
    new Date(Date.parse(`${today}T12:00:00Z`) + 6 * 86_400_000),
    "UTC",
  );
  const tomorrow = isoDateInTimezone(
    new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000),
    "UTC",
  );

  const localDay = (column: AnyColumn) => sql`to_char(${column} at time zone ${tz}, 'YYYY-MM-DD')`;

  const [deadlines, waiting, dueSoon, next] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(attentionItems)
      .where(
        and(
          eq(attentionItems.userId, userId),
          inArray(attentionItems.status, ["open", "seen"]),
          eq(attentionItems.kind, "deadline"),
          sql`${localDay(attentionItems.dueAt)} <= ${weekEnd}`,
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(waitingItems)
      .where(
        and(
          eq(waitingItems.userId, userId),
          inArray(waitingItems.status, ["open", "snoozed"]),
          or(
            sql`${localDay(waitingItems.followUpAt)} <= ${today}`,
            sql`${localDay(waitingItems.expectedAt)} < ${today}`,
          ),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(attentionItems)
      .where(
        and(
          eq(attentionItems.userId, userId),
          inArray(attentionItems.status, ["open", "seen"]),
          sql`${localDay(attentionItems.dueAt)} <= ${today}`,
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(attentionItems)
      .where(
        and(
          eq(attentionItems.userId, userId),
          inArray(attentionItems.status, ["open", "seen"]),
          sql`${localDay(attentionItems.dueAt)} = ${tomorrow}`,
        ),
      ),
  ]);

  return {
    deadlinesThisWeek: deadlines[0]?.n ?? 0,
    waitingDue: waiting[0]?.n ?? 0,
    dueTodayOrOverdue: dueSoon[0]?.n ?? 0,
    tomorrow: next[0]?.n ?? 0,
  };
}

function morningBody(counts: { deadlinesThisWeek: number; waitingDue: number }): string {
  const parts: string[] = [];
  if (counts.deadlinesThisWeek) {
    parts.push(`${counts.deadlinesThisWeek} deadline${counts.deadlinesThisWeek === 1 ? "" : "s"} this week`);
  }
  if (counts.waitingDue) {
    parts.push(`${counts.waitingDue} follow-up${counts.waitingDue === 1 ? "" : "s"} due`);
  }
  const middle = parts.length ? parts.join(" and ") : "a calm day ahead";
  return `Recall: good morning — you have ${middle}. Your briefing is ready: ${config.appPublicUrl}/today`;
}

function eveningBody(counts: { dueTodayOrOverdue: number; tomorrow: number; waitingDue: number }): string {
  const parts: string[] = [];
  if (counts.dueTodayOrOverdue) parts.push(`${counts.dueTodayOrOverdue} unfinished`);
  if (counts.tomorrow) parts.push(`${counts.tomorrow} on deck tomorrow`);
  if (counts.waitingDue) parts.push(`${counts.waitingDue} follow-up${counts.waitingDue === 1 ? "" : "s"} due`);
  const middle = parts.length ? parts.join(", ") : "nothing left open";
  return `Recall: evening check-in — ${middle}. Wrap up your day: ${config.appPublicUrl}/today`;
}

async function sendForKind(
  user: SweepUser,
  kind: "morning" | "evening",
  localDate: string,
  now: Date,
): Promise<boolean> {
  if (!user.phoneNumber) return false;
  const tz = user.timezone ?? recallTimezone();
  const counts = await countBriefingSignals(user.id, tz, localDate);
  const body = kind === "morning" ? morningBody(counts) : eveningBody(counts);

  await smsService.sendSms({ to: user.phoneNumber, body });

  // Conditional marker: only one tick can claim this local date.
  const marker =
    kind === "morning" ? users.lastMorningBriefingOn : users.lastEveningCheckinOn;
  await getDb()
    .update(users)
    .set(kind === "morning" ? { lastMorningBriefingOn: localDate } : { lastEveningCheckinOn: localDate })
    .where(and(eq(users.id, user.id), or(isNull(marker), ne(marker, localDate))));

  void writeAuditLog({
    userId: user.id,
    action: "briefing_sent",
    entityType: "user",
    entityId: user.id,
    metadata: { kind, localDate, at: now.toISOString() },
  });
  return true;
}

let running = false;

/** One sweep pass over all briefing-opted-in users. Self-serializing. */
export async function runBriefingSweep(): Promise<{ morning: number; evening: number }> {
  if (running) return { morning: 0, evening: 0 };
  running = true;
  let morning = 0;
  let evening = 0;
  try {
    const now = new Date();
    const rows = await getDb()
      .select({
        id: users.id,
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
      .where(
        and(
          or(eq(users.morningBriefingEnabled, true), eq(users.eveningCheckinEnabled, true)),
          isNull(users.disabledAt),
        ),
      );

    for (const user of rows) {
      try {
        const morningPlan = decideBriefingSend(
          {
            enabled: user.morningBriefingEnabled,
            time: user.morningBriefingTime,
            quietHoursStart: user.quietHoursStart,
            quietHoursEnd: user.quietHoursEnd,
            lastSentOn: user.lastMorningBriefingOn,
            timezone: user.timezone,
          },
          now,
        );
        if (morningPlan.send && (await sendForKind(user, "morning", morningPlan.localDate, now))) {
          morning += 1;
          user.lastMorningBriefingOn = morningPlan.localDate;
        }

        const eveningPlan = decideBriefingSend(
          {
            enabled: user.eveningCheckinEnabled,
            time: user.eveningCheckinTime,
            quietHoursStart: user.quietHoursStart,
            quietHoursEnd: user.quietHoursEnd,
            lastSentOn: user.lastEveningCheckinOn,
            timezone: user.timezone,
          },
          now,
        );
        if (eveningPlan.send && (await sendForKind(user, "evening", eveningPlan.localDate, now))) {
          evening += 1;
          user.lastEveningCheckinOn = eveningPlan.localDate;
        }
      } catch (err) {
        logger.warn({ err, userId: user.id }, "Briefing sweep send failed for user");
      }
    }
    return { morning, evening };
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;

export function startBriefingSweep(): void {
  if (timer) return;
  if (!smsService.enabled) {
    logger.info("Briefing sweep not started — Twilio is not configured");
    return;
  }
  setTimeout(() => {
    void runBriefingSweep();
  }, 20_000);
  timer = setInterval(() => {
    void runBriefingSweep();
  }, BRIEFING_SWEEP_TICK_MS);
  timer.unref?.();
  logger.info("Briefing sweep started");
}
