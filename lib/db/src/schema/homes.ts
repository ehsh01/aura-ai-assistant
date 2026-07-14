import { index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Structured home / property records for Ask and warranty subject linking.
 * Complements Life Memory domain="home" freeform facts.
 */
export const homes = pgTable(
  "homes",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    addressLine1: varchar("address_line1", { length: 255 }),
    addressLine2: varchar("address_line2", { length: 255 }),
    city: varchar("city", { length: 128 }),
    region: varchar("region", { length: 64 }),
    postalCode: varchar("postal_code", { length: 32 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("homes_user_id_idx").on(table.userId),
    index("homes_display_name_idx").on(table.displayName),
  ],
);

export type Home = typeof homes.$inferSelect;
export type NewHome = typeof homes.$inferInsert;
