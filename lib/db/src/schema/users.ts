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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
