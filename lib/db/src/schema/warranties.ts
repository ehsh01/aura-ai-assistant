import { index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";
import { vehicles } from "./vehicles";

export const WARRANTY_SUBJECT_TYPES = ["vehicle", "home", "other"] as const;
export type WarrantySubjectType = (typeof WARRANTY_SUBJECT_TYPES)[number];

/**
 * Structured warranties with expiry dates for proactive insights.
 * Optionally linked to a vehicle via subjectId when subjectType = vehicle.
 */
export const warranties = pgTable(
  "warranties",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    subjectType: varchar("subject_type", { length: 32 }).notNull().default("other"),
    subjectId: varchar("subject_id", { length: 64 }).references(() => vehicles.id, {
      onDelete: "set null",
    }),
    provider: varchar("provider", { length: 255 }),
    /** Calendar expiry as YYYY-MM-DD. */
    expiresAt: varchar("expires_at", { length: 10 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("warranties_user_id_idx").on(table.userId),
    index("warranties_expires_at_idx").on(table.userId, table.expiresAt),
    index("warranties_subject_idx").on(table.userId, table.subjectType, table.subjectId),
  ],
);

export type Warranty = typeof warranties.$inferSelect;
export type NewWarranty = typeof warranties.$inferInsert;
