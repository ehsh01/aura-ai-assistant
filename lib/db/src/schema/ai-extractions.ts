import { index, jsonb, pgTable, real, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { captures } from "./captures";
import { users } from "./users";

export const aiExtractions = pgTable(
  "ai_extractions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    captureId: varchar("capture_id", { length: 64 })
      .notNull()
      .references(() => captures.id, { onDelete: "cascade" }),
    modelName: varchar("model_name", { length: 64 }),
    promptVersion: varchar("prompt_version", { length: 32 }).notNull(),
    rawResponse: text("raw_response"),
    structuredOutput: jsonb("structured_output").$type<Record<string, unknown>>().notNull().default({}),
    confidenceScore: real("confidence_score"),
    status: varchar("status", { length: 16 }).notNull().default("suggested"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ai_extractions_capture_id_idx").on(table.captureId),
    index("ai_extractions_user_id_idx").on(table.userId),
  ],
);

export type AiExtraction = typeof aiExtractions.$inferSelect;
export type NewAiExtraction = typeof aiExtractions.$inferInsert;
