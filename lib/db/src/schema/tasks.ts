import { boolean, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
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
  title: text("title").notNull(),
  time: varchar("time", { length: 64 }),
  priority: varchar("priority", { length: 16 }).notNull().default("none"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  completed: boolean("completed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
