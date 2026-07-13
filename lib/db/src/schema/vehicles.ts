import { index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Structured vehicles for Ask / warranty tracking.
 * Complements Life Memory domain="vehicles" freeform facts.
 */
export const vehicles = pgTable(
  "vehicles",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    year: varchar("year", { length: 16 }),
    make: varchar("make", { length: 128 }),
    model: varchar("model", { length: 128 }),
    vin: varchar("vin", { length: 64 }),
    licensePlate: varchar("license_plate", { length: 32 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("vehicles_user_id_idx").on(table.userId),
    index("vehicles_vin_idx").on(table.vin),
    index("vehicles_display_name_idx").on(table.displayName),
  ],
);

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
