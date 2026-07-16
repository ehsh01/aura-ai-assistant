import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * captures = the raw, immutable Capture Layer / Raw Capture Repository.
 *
 * Per docs/01_Architecture.md (2.1 Capture First, Interpret Later) and
 * docs/03_Data_Model.md (3.1 Capture), raw input MUST be stored before any AI
 * processing and MUST never be overwritten (docs/02_Cursor_Rules.md Rule 1).
 *
 * This is intentionally distinct from `capture_items`, which stores AI/heuristic
 * *interpretation* (cleaned title + suggestions). Interpretation is derived in a
 * later phase and always references the raw capture as its source of truth.
 */
export const captures = pgTable(
  "captures",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Where the capture came from (connector-agnostic — do not hardcode connectors).
    sourceType: varchar("source_type", { length: 32 }).notNull().default("manual"),
    sourceName: varchar("source_name", { length: 255 }),
    sourceUrl: text("source_url"),
    title: varchar("title", { length: 500 }),
    // Raw payload — immutable after creation.
    rawText: text("raw_text").notNull(),
    rawHtml: text("raw_html"),
    rawMetadata: jsonb("raw_metadata").$type<Record<string, unknown>>().notNull().default({}),
    /** Derived compact digest for Ask — additive; raw_text stays immutable. */
    digest: text("digest"),
    // Processing lifecycle: pending | processing | processed | failed | ignored | archived.
    processedStatus: varchar("processed_status", { length: 16 }).notNull().default("pending"),
    processingError: text("processing_error"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("captures_user_id_idx").on(table.userId),
    index("captures_user_status_idx").on(table.userId, table.processedStatus),
    index("captures_user_captured_at_idx").on(table.userId, table.capturedAt),
  ],
);

export type Capture = typeof captures.$inferSelect;
export type NewCapture = typeof captures.$inferInsert;
