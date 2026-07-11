import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

/** Persistent Ask conversation threads (follow-up questions). */
export const askThreads = pgTable(
  "ask_threads",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull().default("New chat"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ask_threads_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

export const askMessages = pgTable(
  "ask_messages",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    threadId: varchar("thread_id", { length: 64 })
      .notNull()
      .references(() => askThreads.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 16 }).notNull(), // user | assistant
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ask_messages_thread_created_idx").on(table.threadId, table.createdAt),
    index("ask_messages_user_id_idx").on(table.userId),
  ],
);

export type AskThread = typeof askThreads.$inferSelect;
export type NewAskThread = typeof askThreads.$inferInsert;
export type AskMessage = typeof askMessages.$inferSelect;
export type NewAskMessage = typeof askMessages.$inferInsert;
