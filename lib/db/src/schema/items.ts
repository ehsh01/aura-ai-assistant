import { sql } from "drizzle-orm";
import {
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { captures } from "./captures";
import { users } from "./users";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export type ItemMedia = {
  storagePath?: string;
  remoteUrl?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
};

/** Recall-native cards. Connector records remain immutable and are projected at read time. */
export const items = pgTable(
  "items",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    captureId: varchar("capture_id", { length: 64 }).references(() => captures.id, {
      onDelete: "set null",
    }),
    kind: varchar("kind", { length: 32 }).notNull(),
    state: varchar("state", { length: 16 }).notNull().default("ready"),
    source: varchar("source", { length: 32 }).notNull().default("recall"),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    domain: varchar("domain", { length: 255 }),
    sourceUrl: text("source_url"),
    canonicalUrl: text("canonical_url"),
    urlHash: varchar("url_hash", { length: 64 }),
    bodyText: text("body_text").notNull().default(""),
    media: jsonb("media").$type<ItemMedia>().notNull().default({}),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    notebook: varchar("notebook", { length: 500 }),
    searchDocument: text("search_document").notNull().default(""),
    searchTsv: tsvector("search_tsv"),
    bumpedAt: timestamp("bumped_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("items_user_bumped_idx").on(table.userId, table.bumpedAt),
    index("items_user_kind_idx").on(table.userId, table.kind),
    index("items_user_source_idx").on(table.userId, table.source),
    index("items_user_notebook_idx").on(table.userId, table.notebook),
    uniqueIndex("items_user_url_hash_unique")
      .on(table.userId, table.urlHash)
      .where(sql`${table.urlHash} IS NOT NULL`),
  ],
);

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
