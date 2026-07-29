import { boolean, integer, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  /** E.164 (e.g. +15551234567) — used for SMS reminder delivery via Twilio. */
  phoneNumber: varchar("phone_number", { length: 32 }),
  smsRemindersEnabled: boolean("sms_reminders_enabled").notNull().default(false),
  /** Minutes before an attention item's dueAt to send a heads-up text. */
  smsLeadMinutes: integer("sms_lead_minutes").notNull().default(30),
  /** IANA timezone (e.g. "America/New_York"); null falls back to server RECALL_TIMEZONE. */
  timezone: varchar("timezone", { length: 64 }),
  morningBriefingEnabled: boolean("morning_briefing_enabled").notNull().default(false),
  /** Local "HH:MM" (24h) to send the morning briefing nudge. */
  morningBriefingTime: varchar("morning_briefing_time", { length: 5 }).notNull().default("07:30"),
  eveningCheckinEnabled: boolean("evening_checkin_enabled").notNull().default(false),
  /** Local "HH:MM" (24h) to send the evening check-in nudge. */
  eveningCheckinTime: varchar("evening_checkin_time", { length: 5 }).notNull().default("17:30"),
  /** Local "HH:MM" quiet window — no briefing SMS between start and end. */
  quietHoursStart: varchar("quiet_hours_start", { length: 5 }).notNull().default("21:00"),
  quietHoursEnd: varchar("quiet_hours_end", { length: 5 }).notNull().default("08:00"),
  /** User-local ISO dates of the last sends — idempotency markers. */
  lastMorningBriefingOn: varchar("last_morning_briefing_on", { length: 10 }),
  lastEveningCheckinOn: varchar("last_evening_checkin_on", { length: 10 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
