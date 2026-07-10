import { boolean, index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { people } from "./people";
import { projects } from "./projects";
import { users } from "./users";

/** Fixed life-domain taxonomy for permanent memories. */
export const LIFE_MEMORY_DOMAINS = [
  "family",
  "vehicles",
  "home",
  "health",
  "work",
  "finance",
  "people",
  "preferences",
  "procedures",
  "other",
] as const;

export type LifeMemoryDomain = (typeof LIFE_MEMORY_DOMAINS)[number];

export const LIFE_MEMORY_SOURCE_TYPES = ["teach", "capture", "ask", "import"] as const;
export type LifeMemorySourceType = (typeof LIFE_MEMORY_SOURCE_TYPES)[number];

export const lifeMemories = pgTable(
  "life_memories",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    domain: varchar("domain", { length: 32 }).notNull().default("other"),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    primaryPersonId: varchar("primary_person_id", { length: 64 }).references(() => people.id, {
      onDelete: "set null",
    }),
    projectId: varchar("project_id", { length: 64 }).references(() => projects.id, {
      onDelete: "set null",
    }),
    sourceType: varchar("source_type", { length: 16 }).notNull().default("teach"),
    sourceId: varchar("source_id", { length: 64 }),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("life_memories_user_id_idx").on(table.userId),
    index("life_memories_user_domain_idx").on(table.userId, table.domain),
    index("life_memories_primary_person_id_idx").on(table.primaryPersonId),
  ],
);

export type LifeMemory = typeof lifeMemories.$inferSelect;
export type NewLifeMemory = typeof lifeMemories.$inferInsert;
