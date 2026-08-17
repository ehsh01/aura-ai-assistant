import { boolean, customType, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { notebooks } from "./notebooks";
import { people } from "./people";
import { projects } from "./projects";
import { users } from "./users";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

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
  /** Compact Ask/embed digest — never replaces content. */
  summary: text("summary"),
  /** Hash of title+content+attachmentText used to invalidate digest. */
  contentHash: varchar("content_hash", { length: 64 }),
  factBullets: jsonb("fact_bullets").$type<string[]>().notNull().default([]),
  contentFormat: varchar("content_format", { length: 16 }).notNull().default("plain"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  pinned: boolean("pinned").notNull().default(false),
  /** personal | household | work — default personal so existing notes stay private. */
  vault: varchar("vault", { length: 32 }).notNull().default("personal"),
  /** Denormalized note + attachment OCR text for FTS (maintained by DB triggers). */
  searchDocument: text("search_document").notNull().default(""),
  searchTsv: tsvector("search_tsv"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
