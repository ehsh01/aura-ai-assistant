import { boolean, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { notebooks } from "./notebooks";
import { people } from "./people";
import { projects } from "./projects";
import { users } from "./users";

export const notes = pgTable("notes", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  notebookId: varchar("notebook_id", { length: 64 }).references(() => notebooks.id, {
    onDelete: "set null",
  }),
  projectId: varchar("project_id", { length: 64 }).references(() => projects.id, {
    onDelete: "set null",
  }),
  primaryPersonId: varchar("primary_person_id", { length: 64 }).references(() => people.id, {
    onDelete: "set null",
  }),
  title: varchar("title", { length: 500 }).notNull().default("Untitled"),
  content: text("content").notNull().default(""),
  preview: text("preview").notNull().default(""),
  contentFormat: varchar("content_format", { length: 16 }).notNull().default("plain"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
