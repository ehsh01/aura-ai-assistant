import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Persistent embedding store for hybrid retrieval.
 * Vectors are jsonb number[] (no pgvector required at personal scale).
 */
export const entityEmbeddings = pgTable(
  "entity_embeddings",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 32 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }).notNull(),
    contentHash: varchar("content_hash", { length: 32 }).notNull(),
    model: varchar("model", { length: 64 }).notNull(),
    dims: integer("dims").notNull(),
    vector: jsonb("vector").$type<number[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("entity_embeddings_user_entity_model_uidx").on(
      table.userId,
      table.entityType,
      table.entityId,
      table.model,
    ),
    index("entity_embeddings_user_id_idx").on(table.userId),
    index("entity_embeddings_entity_idx").on(table.entityType, table.entityId),
  ],
);

export type EntityEmbedding = typeof entityEmbeddings.$inferSelect;
export type NewEntityEmbedding = typeof entityEmbeddings.$inferInsert;
