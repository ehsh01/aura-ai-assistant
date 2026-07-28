import {
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Durable "waiting on someone else" commitment: another person/vendor owes a
 * deliverable. Separate from attention_items (deadline reminders) and from
 * the heuristic waiting-on scan — this is the tracked, correctable record.
 */
export const waitingItems = pgTable(
  "waiting_items",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Resolved People row when the owner matches; ownerName is always kept as extracted/corrected. */
    ownerPersonId: varchar("owner_person_id", { length: 64 }),
    ownerName: varchar("owner_name", { length: 200 }).notNull(),
    ownerOrg: varchar("owner_org", { length: 200 }),
    /** What was promised (one item per deliverable). */
    deliverable: text("deliverable").notNull(),
    /** When the promise was made (source date). */
    promisedAt: timestamp("promised_at", { withTimezone: true }),
    /** Expected delivery date — only when explicitly stated; never invented. */
    expectedAt: timestamp("expected_at", { withTimezone: true }),
    /** certain | uncertain | none — how solid expectedAt is. */
    dateConfidence: varchar("date_confidence", { length: 16 }).notNull().default("none"),
    /** candidate | open | snoozed | completed | dismissed */
    status: varchar("status", { length: 24 }).notNull().default("open"),
    /** Next follow-up date; surfaces in Today when reached. */
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    /** completed | revised_delayed | still_waiting | unclear */
    lastOutcome: varchar("last_outcome", { length: 24 }),
    lastReplySourceRecordId: varchar("last_reply_source_record_id", { length: 64 }),
    /** Optional links to an existing project / delegated task. */
    projectId: varchar("project_id", { length: 64 }),
    taskId: varchar("task_id", { length: 64 }),
    /** Extraction confidence 0..1. */
    confidence: real("confidence").notNull().default(0.5),
    /** Normalized owner+deliverable used to dedupe active commitments. */
    fingerprint: varchar("fingerprint", { length: 300 }).notNull(),
    /** Gmail threadId when the source is email — used for reply matching. */
    threadId: varchar("thread_id", { length: 128 }),
    sourceEntityType: varchar("source_entity_type", { length: 32 }).notNull(),
    sourceEntityId: varchar("source_entity_id", { length: 64 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One active commitment/candidate per owner+deliverable; history in audit_log.
    uniqueIndex("waiting_items_active_fingerprint_uidx")
      .on(table.userId, table.fingerprint)
      .where(sql`status in ('open', 'snoozed', 'candidate')`),
    index("waiting_items_user_status_followup_idx").on(
      table.userId,
      table.status,
      table.followUpAt,
    ),
    index("waiting_items_user_thread_idx").on(table.userId, table.threadId),
  ],
);

export type WaitingItem = typeof waitingItems.$inferSelect;
export type NewWaitingItem = typeof waitingItems.$inferInsert;
