import { integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { users } from "./users";

export const noteAttachments = pgTable("note_attachments", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  noteId: varchar("note_id", { length: 64 })
    .notNull()
    .references(() => notes.id, { onDelete: "cascade" }),
  resourceHash: varchar("resource_hash", { length: 64 }).notNull().default(""),
  fileName: varchar("file_name", { length: 500 }).notNull().default("attachment"),
  mimeType: varchar("mime_type", { length: 128 }).notNull().default("application/octet-stream"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  storagePath: varchar("storage_path", { length: 1024 }).notNull(),
  /** OCR / PDF / plain-text extracted for Notes search. */
  extractedText: text("extracted_text"),
  extractedAt: timestamp("extracted_at", { withTimezone: true }),
  /** SHA-256 of file bytes; reused so identical images are not OCR'd twice. */
  contentHash: varchar("content_hash", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type NoteAttachment = typeof noteAttachments.$inferSelect;
export type NewNoteAttachment = typeof noteAttachments.$inferInsert;
