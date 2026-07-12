import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Revocable, capture-only credentials for the browser extension.
 *
 * Only a SHA-256 hash is stored. The raw token is returned once when created.
 */
export const extensionTokens = pgTable(
  "extension_tokens",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull().default("Recall browser extension"),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    scope: varchar("scope", { length: 64 }).notNull().default("capture:create"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "extension_tokens_scope_check",
      sql`${table.scope} = 'capture:create'`,
    ),
    check(
      "extension_tokens_hash_check",
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "extension_tokens_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    uniqueIndex("extension_tokens_token_hash_uidx").on(table.tokenHash),
    index("extension_tokens_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export type ExtensionToken = typeof extensionTokens.$inferSelect;
export type NewExtensionToken = typeof extensionTokens.$inferInsert;
