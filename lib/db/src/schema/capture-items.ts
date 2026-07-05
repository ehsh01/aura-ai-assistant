import { jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { notebooks } from "./notebooks";
import { projects } from "./projects";
import { users } from "./users";

export const captureItems = pgTable("capture_items", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  rawText: text("raw_text").notNull(),
  cleanedTitle: varchar("cleaned_title", { length: 500 }).notNull().default("Untitled capture"),
  suggestedType: varchar("suggested_type", { length: 32 }).notNull().default("note"),
  suggestedPriority: varchar("suggested_priority", { length: 16 }).notNull().default("medium"),
  suggestedDueDate: varchar("suggested_due_date", { length: 64 }),
  suggestedProject: varchar("suggested_project", { length: 500 }),
  suggestedTags: jsonb("suggested_tags").$type<string[]>().notNull().default([]),
  suggestedActions: jsonb("suggested_actions").$type<string[]>().notNull().default([]),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  projectId: varchar("project_id", { length: 64 }).references(() => projects.id, {
    onDelete: "set null",
  }),
  notebookId: varchar("notebook_id", { length: 64 }).references(() => notebooks.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CaptureItem = typeof captureItems.$inferSelect;
export type NewCaptureItem = typeof captureItems.$inferInsert;
