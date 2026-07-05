import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

export const notebooks = pgTable("notebooks", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 500 }).notNull(),
  source: varchar("source", { length: 32 }).notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Notebook = typeof notebooks.$inferSelect;
