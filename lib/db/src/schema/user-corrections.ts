import { index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

export const userCorrections = pgTable(
  "user_corrections",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 32 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }).notNull(),
    fieldName: varchar("field_name", { length: 64 }).notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("user_corrections_entity_idx").on(table.entityType, table.entityId),
    index("user_corrections_user_id_idx").on(table.userId),
  ],
);

export type UserCorrection = typeof userCorrections.$inferSelect;
export type NewUserCorrection = typeof userCorrections.$inferInsert;
