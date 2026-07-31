import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export type ActionProposalStatus =
  | "proposed"
  | "confirmed"
  | "executed"
  | "cancelled"
  | "superseded"
  | "failed";

export const actionProposals = pgTable(
  "action_proposals",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: varchar("thread_id", { length: 64 }),
    captureId: varchar("capture_id", { length: 64 }),
    actionType: varchar("action_type", { length: 32 }).notNull(),
    label: varchar("label", { length: 128 }).notNull().default(""),
    draft: jsonb("draft").$type<Record<string, unknown>>().notNull().default({}),
    explanation: text("explanation").notNull().default(""),
    confidence: real("confidence").notNull().default(0),
    riskLevel: varchar("risk_level", { length: 16 }).notNull().default("low"),
    confirmationRequired: boolean("confirmation_required").notNull().default(true),
    status: varchar("status", { length: 24 }).notNull().default("proposed"),
    version: integer("version").notNull().default(1),
    supersedesId: varchar("supersedes_id", { length: 64 }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    executedEntityType: varchar("executed_entity_type", { length: 64 }),
    executedEntityId: varchar("executed_entity_id", { length: 64 }),
    model: varchar("model", { length: 96 }),
    promptVersion: varchar("prompt_version", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("action_proposals_user_status_idx").on(table.userId, table.status, table.createdAt),
    index("action_proposals_thread_idx").on(table.userId, table.threadId, table.createdAt),
  ],
);

export type ActionProposalRow = typeof actionProposals.$inferSelect;
export type NewActionProposalRow = typeof actionProposals.$inferInsert;
