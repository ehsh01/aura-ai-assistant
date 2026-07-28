import { sql } from "drizzle-orm";
import {
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { captures } from "./captures";
import { notebooks } from "./notebooks";
import { projects } from "./projects";
import { users } from "./users";

/** Suggested link from a capture to an existing entity (match-only; never auto-created). */
export type CaptureSuggestedLink = {
  entityType: "person" | "project";
  /** Matched row id, or null when the name has no match (created only on user accept). */
  entityId: string | null;
  name: string;
  matched: boolean;
  reason: string;
};

export const captureItems = pgTable(
  "capture_items",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rawCaptureId: varchar("raw_capture_id", { length: 64 }).references(() => captures.id, {
      onDelete: "set null",
    }),
    rawText: text("raw_text").notNull(),
    cleanedTitle: varchar("cleaned_title", { length: 500 }).notNull().default("Untitled capture"),
    suggestedType: varchar("suggested_type", { length: 32 }).notNull().default("note"),
    suggestedPriority: varchar("suggested_priority", { length: 16 }).notNull().default("medium"),
    suggestedDueDate: varchar("suggested_due_date", { length: 64 }),
    suggestedProject: varchar("suggested_project", { length: 500 }),
    suggestedTags: jsonb("suggested_tags").$type<string[]>().notNull().default([]),
    suggestedActions: jsonb("suggested_actions").$type<string[]>().notNull().default([]),
    /** pending | accepted | dismissed | snoozed */
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    /** Classification confidence 0..1 (null for pre-0028 rows). */
    confidence: doublePrecision("confidence"),
    suggestedLinks: jsonb("suggested_links").$type<CaptureSuggestedLink[]>().notNull().default([]),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    /** Pipeline details: types[], autoAccepted, promptVersion. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    projectId: varchar("project_id", { length: 64 }).references(() => projects.id, {
      onDelete: "set null",
    }),
    notebookId: varchar("notebook_id", { length: 64 }).references(() => notebooks.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One inbox row per raw capture — reprocessing retries can't duplicate.
    uniqueIndex("capture_items_raw_capture_unique")
      .on(table.rawCaptureId)
      .where(sql`raw_capture_id is not null`),
  ],
);

export type CaptureItem = typeof captureItems.$inferSelect;
export type NewCaptureItem = typeof captureItems.$inferInsert;
