import { index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

export const ORGANIZATION_TYPES = [
  "vendor",
  "contractor",
  "employer",
  "agency",
  "other",
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

/**
 * Structured organizations (vendors, contractors, employers).
 * Complements the freeform people.organization string field.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    orgType: varchar("org_type", { length: 32 }).notNull().default("other"),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 64 }),
    website: varchar("website", { length: 500 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("organizations_user_id_idx").on(table.userId),
    index("organizations_display_name_idx").on(table.displayName),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
