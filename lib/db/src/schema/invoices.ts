import { index, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";
import { organizations } from "./organizations";

export const INVOICE_STATUSES = ["open", "paid", "void", "other"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * Structured invoices for Ask / overdue insights.
 * Optional organization link; amount stored in cents.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    organizationId: varchar("organization_id", { length: 64 }).references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
    /** Amount in minor units (cents). */
    amountCents: integer("amount_cents"),
    currency: varchar("currency", { length: 8 }).notNull().default("USD"),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    invoiceDate: varchar("invoice_date", { length: 10 }),
    dueDate: varchar("due_date", { length: 10 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("invoices_user_id_idx").on(table.userId),
    index("invoices_org_idx").on(table.userId, table.organizationId),
    index("invoices_due_date_idx").on(table.userId, table.dueDate),
    index("invoices_status_idx").on(table.userId, table.status),
  ],
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
