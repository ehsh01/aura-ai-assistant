import { index, pgTable, real, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { people } from "./people";
import { users } from "./users";

export const PERSON_IDENTITY_KINDS = ["email", "phone", "nickname", "external"] as const;
export type PersonIdentityKind = (typeof PERSON_IDENTITY_KINDS)[number];

export const personIdentities = pgTable(
  "person_identities",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    personId: varchar("person_id", { length: 64 })
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32 }).notNull(),
    value: varchar("value", { length: 320 }).notNull(),
    confidence: real("confidence").notNull().default(1),
    source: varchar("source", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("person_identities_user_kind_value_idx").on(table.userId, table.kind, table.value),
    index("person_identities_person_idx").on(table.personId),
    index("person_identities_user_idx").on(table.userId),
  ],
);

export type PersonIdentity = typeof personIdentities.$inferSelect;
export type NewPersonIdentity = typeof personIdentities.$inferInsert;
