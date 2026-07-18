import {
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const attentionItems = pgTable(
  "attention_items",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    summary: text("summary"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull().default("deadline"),
    status: varchar("status", { length: 32 }).notNull().default("open"),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    sourceEntityType: varchar("source_entity_type", { length: 32 }).notNull(),
    sourceEntityId: varchar("source_entity_id", { length: 64 }).notNull(),
    evidenceText: text("evidence_text"),
    personId: varchar("person_id", { length: 64 }),
    projectId: varchar("project_id", { length: 64 }),
    confidence: real("confidence"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("attention_items_source_due_uidx").on(
      table.userId,
      table.sourceEntityType,
      table.sourceEntityId,
      table.dueAt,
    ),
    index("attention_items_user_status_due_idx").on(
      table.userId,
      table.status,
      table.dueAt,
    ),
  ],
);

export type AttentionItem = typeof attentionItems.$inferSelect;
export type NewAttentionItem = typeof attentionItems.$inferInsert;
