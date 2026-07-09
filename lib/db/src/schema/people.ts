import { index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

export const people = pgTable(
  "people",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    firstName: varchar("first_name", { length: 128 }),
    lastName: varchar("last_name", { length: 128 }),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 64 }),
    organization: varchar("organization", { length: 255 }),
    department: varchar("department", { length: 255 }),
    role: varchar("role", { length: 255 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("people_user_id_idx").on(table.userId),
    index("people_email_idx").on(table.email),
    index("people_display_name_idx").on(table.displayName),
  ],
);

export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
