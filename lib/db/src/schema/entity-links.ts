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
 * Typed relationships between Recall entities (person ↔ note/task/etc).
 * Complements FK columns; enables shared-context retrieval without scanning tags.
 */
export const entityLinks = pgTable(
  "entity_links",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fromEntityType: varchar("from_entity_type", { length: 32 }).notNull(),
    fromEntityId: varchar("from_entity_id", { length: 64 }).notNull(),
    toEntityType: varchar("to_entity_type", { length: 32 }).notNull(),
    toEntityId: varchar("to_entity_id", { length: 64 }).notNull(),
    linkType: varchar("link_type", { length: 64 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("entity_links_unique_idx").on(
      table.userId,
      table.fromEntityType,
      table.fromEntityId,
      table.toEntityType,
      table.toEntityId,
      table.linkType,
    ),
    index("entity_links_from_idx").on(
      table.userId,
      table.fromEntityType,
      table.fromEntityId,
    ),
    index("entity_links_to_idx").on(table.userId, table.toEntityType, table.toEntityId),
  ],
);

export type EntityLink = typeof entityLinks.$inferSelect;
export type NewEntityLink = typeof entityLinks.$inferInsert;
