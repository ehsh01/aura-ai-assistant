import { boolean, index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

export const connectors = pgTable(
  "connectors",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    description: text("description"),
    baseUrl: text("base_url"),
    authType: varchar("auth_type", { length: 32 }),
    enabled: boolean("enabled").notNull().default(true),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    syncStatus: varchar("sync_status", { length: 32 }).notNull().default("disconnected"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("connectors_user_id_idx").on(table.userId),
    index("connectors_type_idx").on(table.type),
  ],
);

export type Connector = typeof connectors.$inferSelect;
export type NewConnector = typeof connectors.$inferInsert;
