import { pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

export const waitingDismissals = pgTable(
  "waiting_dismissals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    waitingItemId: varchar("waiting_item_id", { length: 128 }).notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("waiting_dismissals_user_item_uidx").on(table.userId, table.waitingItemId),
  ],
);

export type WaitingDismissal = typeof waitingDismissals.$inferSelect;
export type NewWaitingDismissal = typeof waitingDismissals.$inferInsert;
