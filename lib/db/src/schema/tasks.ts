import { boolean, jsonb, pgTable, real, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { captures } from "./captures";
import { people } from "./people";
import { projects } from "./projects";
import { users } from "./users";

export const tasks = pgTable("tasks", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: varchar("project_id", { length: 64 }).references(() => projects.id, {
    onDelete: "set null",
  }),
  requesterPersonId: varchar("requester_person_id", { length: 64 }).references(() => people.id, {
    onDelete: "set null",
  }),
  sourceCaptureId: varchar("source_capture_id", { length: 64 }).references(() => captures.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  time: varchar("time", { length: 64 }),
  priority: varchar("priority", { length: 16 }).notNull().default("none"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  completed: boolean("completed").notNull().default(false),
  confidenceScore: real("confidence_score"),
  aiGenerated: boolean("ai_generated").notNull().default(false),
  userConfirmed: boolean("user_confirmed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
