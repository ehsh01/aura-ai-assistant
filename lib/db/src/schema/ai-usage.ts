import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * One row per billable model call. Metadata only — never prompt or completion
 * text — so this table is safe to read for cost analysis.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** Product area that spent the money, e.g. "attachment_ocr". */
    feature: varchar("feature", { length: 64 }).notNull(),
    model: varchar("model", { length: 96 }).notNull(),
    /** True when a background job made the call, not a user action. */
    background: boolean("background").notNull().default(false),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    /** Micro-dollars (1e-6 USD); integers avoid float drift on tiny costs. */
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ai_usage_created_idx").on(table.createdAt),
    index("ai_usage_feature_idx").on(table.feature, table.createdAt),
    index("ai_usage_user_idx").on(table.userId, table.createdAt),
  ],
);

export type AiUsageRow = typeof aiUsage.$inferSelect;
export type NewAiUsageRow = typeof aiUsage.$inferInsert;
