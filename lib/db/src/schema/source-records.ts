import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { connectors } from "./connectors";
import { users } from "./users";

export const sourceRecords = pgTable(
  "source_records",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectorId: varchar("connector_id", { length: 64 })
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 255 }).notNull(),
    recordType: varchar("record_type", { length: 32 }).notNull(),
    recordTitle: varchar("record_title", { length: 500 }),
    recordText: text("record_text"),
    recordMetadata: jsonb("record_metadata").$type<Record<string, unknown>>().notNull().default({}),
    sourceUrl: text("source_url"),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("source_records_connector_external_idx").on(table.connectorId, table.externalId),
    index("source_records_user_id_idx").on(table.userId),
  ],
);

export type SourceRecord = typeof sourceRecords.$inferSelect;
export type NewSourceRecord = typeof sourceRecords.$inferInsert;
