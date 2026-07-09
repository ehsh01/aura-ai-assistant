import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { users } from "./users";

export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content").notNull().default(""),
    itemType: varchar("item_type", { length: 32 }).notNull().default("note"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    projectId: varchar("project_id", { length: 64 }).references(() => projects.id, {
      onDelete: "set null",
    }),
    sourceCaptureId: varchar("source_capture_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("knowledge_items_user_id_idx").on(table.userId)],
);

export type KnowledgeItem = typeof knowledgeItems.$inferSelect;
export type NewKnowledgeItem = typeof knowledgeItems.$inferInsert;
