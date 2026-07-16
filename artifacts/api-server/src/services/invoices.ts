import { and, asc, desc, eq } from "drizzle-orm";
import {
  INVOICE_STATUSES,
  invoices,
  type Invoice,
  type InvoiceStatus,
} from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newInvoiceId } from "../lib/recall-format";
import { writeAuditLog } from "./audit";
import { warmEntityEmbedding } from "./embedding-cache";
import { upsertEntityLink } from "./entity-links";
import { getOrganizationForUser } from "./organizations";

export type InvoiceDto = {
  id: string;
  title: string;
  organizationId: string | null;
  organizationName: string | null;
  amountCents: number | null;
  currency: string;
  status: InvoiceStatus;
  invoiceDate: string | null;
  dueDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateInvoiceInput = {
  title: string;
  organizationId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  status?: InvoiceStatus | string;
  invoiceDate?: string | null;
  dueDate?: string | null;
  notes?: string | null;
};

export type UpdateInvoiceInput = Partial<CreateInvoiceInput>;

function normalizeStatus(raw?: string | null): InvoiceStatus {
  if (raw && (INVOICE_STATUSES as readonly string[]).includes(raw)) {
    return raw as InvoiceStatus;
  }
  return "open";
}

function normalizeDate(raw?: string | null): string | null {
  if (raw == null || raw.trim() === "") return null;
  const v = raw.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function toDto(row: Invoice, organizationName: string | null = null): InvoiceDto {
  return {
    id: row.id,
    title: row.title,
    organizationId: row.organizationId ?? null,
    organizationName,
    amountCents: row.amountCents ?? null,
    currency: row.currency || "USD",
    status: normalizeStatus(row.status),
    invoiceDate: row.invoiceDate ?? null,
    dueDate: row.dueDate ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function formatAmount(cents: number | null, currency: string): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

function invoiceSearchText(dto: InvoiceDto): string {
  return [
    dto.title,
    dto.organizationName,
    formatAmount(dto.amountCents, dto.currency),
    dto.status,
    dto.dueDate ? `due ${dto.dueDate}` : null,
    dto.invoiceDate ? `invoiced ${dto.invoiceDate}` : null,
    dto.notes,
  ]
    .filter(Boolean)
    .join(" ");
}

async function resolveOrgName(
  userId: string,
  organizationId: string | null,
): Promise<string | null> {
  if (!organizationId) return null;
  const org = await getOrganizationForUser(userId, organizationId);
  return org?.displayName ?? null;
}

async function syncOrgLink(
  userId: string,
  invoiceId: string,
  organizationId: string | null,
): Promise<void> {
  if (!organizationId) return;
  await upsertEntityLink(userId, {
    fromEntityType: "invoice",
    fromEntityId: invoiceId,
    toEntityType: "organization",
    toEntityId: organizationId,
    linkType: "issued_by",
  });
}

export async function createInvoiceForUser(
  userId: string,
  input: CreateInvoiceInput,
): Promise<InvoiceDto> {
  let organizationId = input.organizationId ?? null;
  if (organizationId) {
    const org = await getOrganizationForUser(userId, organizationId);
    if (!org) organizationId = null;
  }

  const now = new Date();
  const [row] = await getDb()
    .insert(invoices)
    .values({
      id: newInvoiceId(),
      userId,
      title: input.title.trim() || "Untitled invoice",
      organizationId,
      amountCents:
        input.amountCents != null && Number.isFinite(input.amountCents)
          ? Math.round(input.amountCents)
          : null,
      currency: (input.currency?.trim() || "USD").toUpperCase().slice(0, 8),
      status: normalizeStatus(input.status),
      invoiceDate: normalizeDate(input.invoiceDate),
      dueDate: normalizeDate(input.dueDate),
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const organizationName = await resolveOrgName(userId, organizationId);
  const dto = toDto(row!, organizationName);
  await syncOrgLink(userId, dto.id, organizationId);
  await writeAuditLog({
    userId,
    action: "invoice_created",
    entityType: "invoice",
    entityId: dto.id,
    metadata: { title: dto.title, dueDate: dto.dueDate },
  });
  warmEntityEmbedding(userId, {
    entityType: "invoice",
    entityId: dto.id,
    text: invoiceSearchText(dto),
  });
  return dto;
}

export async function listInvoicesForUser(
  userId: string,
  options: { limit?: number } = {},
): Promise<InvoiceDto[]> {
  const query = getDb()
    .select()
    .from(invoices)
    .where(eq(invoices.userId, userId))
    .orderBy(asc(invoices.dueDate), desc(invoices.updatedAt));
  const rows = await (options.limit ? query.limit(options.limit) : query);

  const out: InvoiceDto[] = [];
  for (const row of rows) {
    const organizationName = await resolveOrgName(userId, row.organizationId ?? null);
    out.push(toDto(row, organizationName));
  }
  return out;
}

export async function getInvoiceForUser(
  userId: string,
  invoiceId: string,
): Promise<InvoiceDto | null> {
  const rows = await getDb()
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
    .limit(1);
  if (!rows[0]) return null;
  const organizationName = await resolveOrgName(userId, rows[0].organizationId ?? null);
  return toDto(rows[0], organizationName);
}

export async function updateInvoiceForUser(
  userId: string,
  invoiceId: string,
  input: UpdateInvoiceInput,
): Promise<InvoiceDto | null> {
  const existing = await getInvoiceForUser(userId, invoiceId);
  if (!existing) return null;

  let organizationId =
    input.organizationId !== undefined ? input.organizationId : existing.organizationId;
  if (organizationId) {
    const org = await getOrganizationForUser(userId, organizationId);
    if (!org) organizationId = null;
  }

  const [row] = await getDb()
    .update(invoices)
    .set({
      ...(input.title !== undefined
        ? { title: input.title.trim() || "Untitled invoice" }
        : {}),
      organizationId,
      ...(input.amountCents !== undefined
        ? {
            amountCents:
              input.amountCents != null && Number.isFinite(input.amountCents)
                ? Math.round(input.amountCents)
                : null,
          }
        : {}),
      ...(input.currency !== undefined
        ? { currency: (input.currency?.trim() || "USD").toUpperCase().slice(0, 8) }
        : {}),
      ...(input.status !== undefined ? { status: normalizeStatus(input.status) } : {}),
      ...(input.invoiceDate !== undefined
        ? { invoiceDate: normalizeDate(input.invoiceDate) }
        : {}),
      ...(input.dueDate !== undefined ? { dueDate: normalizeDate(input.dueDate) } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
    .returning();
  if (!row) return null;

  const organizationName = await resolveOrgName(userId, organizationId);
  const dto = toDto(row, organizationName);
  await syncOrgLink(userId, dto.id, organizationId);
  warmEntityEmbedding(userId, {
    entityType: "invoice",
    entityId: dto.id,
    text: invoiceSearchText(dto),
  });
  return dto;
}

export async function deleteInvoiceForUser(
  userId: string,
  invoiceId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .delete(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
    .returning({ id: invoices.id });
  if (!row) return false;
  await writeAuditLog({
    userId,
    action: "invoice_deleted",
    entityType: "invoice",
    entityId: invoiceId,
  });
  return true;
}

/** Pure: open invoices due soon or recently overdue. */
export function findAttentionInvoices(
  items: {
    id: string;
    title: string;
    status: string;
    dueDate: string | null;
    amountCents?: number | null;
    currency?: string;
    organizationName?: string | null;
  }[],
  opts?: { upcomingDays?: number; pastGraceDays?: number; todayIso?: string },
): {
  id: string;
  title: string;
  dueDate: string;
  daysUntil: number;
  amountLabel: string | null;
  organizationName: string | null;
}[] {
  const upcomingDays = opts?.upcomingDays ?? 30;
  const pastGraceDays = opts?.pastGraceDays ?? 60;
  const todayIso = opts?.todayIso ?? new Date().toISOString().slice(0, 10);
  const today = new Date(`${todayIso}T12:00:00Z`).getTime();

  const out: {
    id: string;
    title: string;
    dueDate: string;
    daysUntil: number;
    amountLabel: string | null;
    organizationName: string | null;
  }[] = [];

  for (const inv of items) {
    if (inv.status === "paid" || inv.status === "void") continue;
    if (!inv.dueDate) continue;
    const due = new Date(`${inv.dueDate}T12:00:00Z`).getTime();
    if (Number.isNaN(due)) continue;
    const daysUntil = Math.round((due - today) / 86_400_000);
    if (daysUntil < -pastGraceDays || daysUntil > upcomingDays) continue;
    out.push({
      id: inv.id,
      title: inv.title,
      dueDate: inv.dueDate,
      daysUntil,
      amountLabel: formatAmount(inv.amountCents ?? null, inv.currency ?? "USD"),
      organizationName: inv.organizationName ?? null,
    });
  }

  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}
