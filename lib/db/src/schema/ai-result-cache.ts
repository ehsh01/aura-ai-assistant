import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Durable, content-addressed results for bounded AI features.
 *
 * Rows are claimed before the provider call. The initial deterministic result
 * therefore also acts as a fail-closed reservation: the same input hash is
 * never sent to the provider twice, even after a failed attempt.
 */
export const aiResultCache = pgTable(
  "ai_result_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feature: varchar("feature", { length: 64 }).notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("ai_result_cache_user_feature_hash_idx").on(
      table.userId,
      table.feature,
      table.inputHash,
    ),
    index("ai_result_cache_user_feature_created_idx").on(
      table.userId,
      table.feature,
      table.createdAt,
    ),
  ],
);

export type AiResultCacheRow = typeof aiResultCache.$inferSelect;
