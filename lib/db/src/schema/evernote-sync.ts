import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { connectors } from "./connectors";
import { sourceRecords } from "./source-records";
import { users } from "./users";

export const evernoteContainers = pgTable(
  "evernote_containers",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectorId: varchar("connector_id", { length: 64 })
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 500 }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    name: varchar("name", { length: 1000 }).notNull(),
    parentExternalId: varchar("parent_external_id", { length: 500 }),
    stackName: varchar("stack_name", { length: 1000 }),
    spaceExternalId: varchar("space_external_id", { length: 500 }),
    access: varchar("access", { length: 64 }),
    expectedNoteCount: integer("expected_note_count"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("evernote_containers_connector_external_kind_idx").on(
      table.connectorId,
      table.externalId,
      table.kind,
    ),
    index("evernote_containers_user_connector_idx").on(table.userId, table.connectorId),
  ],
);

export const evernoteTags = pgTable(
  "evernote_tags",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectorId: varchar("connector_id", { length: 64 })
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 500 }).notNull(),
    name: varchar("name", { length: 1000 }).notNull(),
    parentExternalId: varchar("parent_external_id", { length: 500 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("evernote_tags_connector_external_idx").on(
      table.connectorId,
      table.externalId,
    ),
    index("evernote_tags_user_connector_idx").on(table.userId, table.connectorId),
  ],
);

export const evernoteTasks = pgTable(
  "evernote_tasks",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectorId: varchar("connector_id", { length: 64 })
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    sourceRecordId: varchar("source_record_id", { length: 64 }).references(
      () => sourceRecords.id,
      { onDelete: "cascade" },
    ),
    noteExternalId: varchar("note_external_id", { length: 500 }),
    externalId: varchar("external_id", { length: 500 }).notNull(),
    label: text("label").notNull().default(""),
    description: text("description"),
    status: varchar("status", { length: 64 }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    priority: varchar("priority", { length: 64 }),
    flagged: boolean("flagged").notNull().default(false),
    recurring: boolean("recurring").notNull().default(false),
    assignee: varchar("assignee", { length: 500 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("evernote_tasks_connector_external_idx").on(
      table.connectorId,
      table.externalId,
    ),
    index("evernote_tasks_source_record_idx").on(table.sourceRecordId),
    index("evernote_tasks_note_external_idx").on(table.connectorId, table.noteExternalId),
  ],
);

export const evernoteAttachments = pgTable(
  "evernote_attachments",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectorId: varchar("connector_id", { length: 64 })
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    sourceRecordId: varchar("source_record_id", { length: 64 })
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 500 }).notNull(),
    evernoteHash: varchar("evernote_hash", { length: 128 }),
    sha256: varchar("sha256", { length: 64 }),
    mime: varchar("mime", { length: 255 }),
    fileName: text("file_name"),
    sizeBytes: integer("size_bytes"),
    sourceUrl: text("source_url"),
    extractedText: text("extracted_text"),
    textEngine: varchar("text_engine", { length: 32 }),
    fetchState: varchar("fetch_state", { length: 32 }).notNull().default("pending"),
    fetchError: text("fetch_error"),
    attempts: integer("attempts").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    extractedAt: timestamp("extracted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("evernote_attachments_source_external_idx").on(
      table.sourceRecordId,
      table.externalId,
    ),
    index("evernote_attachments_connector_state_idx").on(
      table.connectorId,
      table.fetchState,
      table.createdAt,
    ),
    index("evernote_attachments_sha256_idx").on(table.connectorId, table.sha256),
  ],
);

export const evernoteSyncState = pgTable(
  "evernote_sync_state",
  {
    connectorId: varchar("connector_id", { length: 64 })
      .primaryKey()
      .references(() => connectors.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    phase: varchar("phase", { length: 32 }).notNull().default("structure"),
    cursor: jsonb("cursor").$type<Record<string, unknown>>().notNull().default({}),
    report: jsonb("report").$type<Record<string, unknown>>().notNull().default({}),
    lastIncrementalAt: timestamp("last_incremental_at", { withTimezone: true }),
    lastFullReconcileAt: timestamp("last_full_reconcile_at", { withTimezone: true }),
    watchdogPausedAt: timestamp("watchdog_paused_at", { withTimezone: true }),
    watchdogReason: text("watchdog_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("evernote_sync_state_user_idx").on(table.userId)],
);

export type EvernoteAttachment = typeof evernoteAttachments.$inferSelect;
export type EvernoteContainer = typeof evernoteContainers.$inferSelect;
export type EvernoteTask = typeof evernoteTasks.$inferSelect;
