import { index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { connectors } from "./connectors";
import { users } from "./users";

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectorId: varchar("connector_id", { length: 64 })
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 32 }).notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    recordsFetched: integer("records_fetched").notNull().default(0),
    recordsCreated: integer("records_created").notNull().default(0),
    recordsUpdated: integer("records_updated").notNull().default(0),
    recordsFailed: integer("records_failed").notNull().default(0),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("sync_runs_connector_id_idx").on(table.connectorId),
    index("sync_runs_user_id_idx").on(table.userId),
  ],
);

export type SyncRun = typeof syncRuns.$inferSelect;
export type NewSyncRun = typeof syncRuns.$inferInsert;
