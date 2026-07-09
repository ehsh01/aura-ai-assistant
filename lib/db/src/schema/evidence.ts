import { index, jsonb, pgTable, integer, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { captures } from "./captures";
import { users } from "./users";

export const evidence = pgTable(
  "evidence",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 32 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }).notNull(),
    claimType: varchar("claim_type", { length: 64 }).notNull(),
    sourceCaptureId: varchar("source_capture_id", { length: 64 }).references(() => captures.id, {
      onDelete: "set null",
    }),
    sourceRecordId: varchar("source_record_id", { length: 64 }),
    evidenceText: text("evidence_text"),
    evidenceMetadata: jsonb("evidence_metadata").$type<Record<string, unknown>>().notNull().default({}),
    fileName: varchar("file_name", { length: 500 }),
    fileId: varchar("file_id", { length: 64 }),
    rowNumber: integer("row_number"),
    pageNumber: integer("page_number"),
    url: text("url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("evidence_entity_idx").on(table.entityType, table.entityId),
    index("evidence_source_capture_idx").on(table.sourceCaptureId),
    index("evidence_user_id_idx").on(table.userId),
  ],
);

export type Evidence = typeof evidence.$inferSelect;
export type NewEvidence = typeof evidence.$inferInsert;
