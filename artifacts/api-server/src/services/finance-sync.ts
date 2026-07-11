import { and, desc, eq } from "drizzle-orm";
import { sourceRecords } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { listConnectorsForUser } from "./connectors";
import { aggregateFinance, parseFinanceDateRange } from "./query-utils";
import type { QueryFinanceAggregate } from "./ai";

export type SyncedFinanceResult = {
  finance: QueryFinanceAggregate;
  connectorId: string;
  needsSync: boolean;
  payeeFilter: string | null;
};

/** Pull a likely payee/merchant name out of a spending question. */
export function extractPayeeHint(question: string): string | null {
  const patterns = [
    /\b(?:at|from|to|with)\s+([A-Za-z0-9&.'\-\s]{2,40}?)(?:\s+(?:last|this|in|for|during|on)\b|[?.!]|$)/i,
    /\b(?:spent|spend|spending|paid|pay|bought|purchase(?:d)?)\s+(?:at\s+)?([A-Za-z0-9&.'\-]{2,40})\b/i,
  ];
  for (const re of patterns) {
    const m = question.match(re);
    const raw = m?.[1]?.trim();
    if (!raw) continue;
    // Drop generic time/filler words that aren't merchants.
    if (/^(last|this|the|my|a|an|month|week|year|today|money|cash)$/i.test(raw)) continue;
    return raw.replace(/\s+/g, " ").slice(0, 60);
  }
  return null;
}

/**
 * Aggregate finance from already-synced source_records.
 * Prefer this over live external API calls for Ask/Home.
 */
export async function loadSyncedFinanceAggregate(
  userId: string,
  question: string,
  today: string,
): Promise<SyncedFinanceResult | null> {
  const connectors = await listConnectorsForUser(userId);
  const financeConn = connectors.find((c) => c.type === "finance_api");
  if (!financeConn) return null;

  const range = parseFinanceDateRange(question, today);
  const payeeFilter = extractPayeeHint(question);

  const rows = await getDb()
    .select({
      recordMetadata: sourceRecords.recordMetadata,
      sourceCreatedAt: sourceRecords.sourceCreatedAt,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.connectorId, financeConn.id),
        eq(sourceRecords.recordType, "finance_transaction"),
      ),
    )
    .orderBy(desc(sourceRecords.sourceCreatedAt))
    .limit(8000);

  if (rows.length === 0) {
    return {
      finance: {
        total: 0,
        spent: 0,
        income: 0,
        count: 0,
        expenseCount: 0,
        incomeCount: 0,
        rangeLabel: range.label,
        topPayees: [],
        topCategories: [],
        formatted: {
          net: "$0.00",
          spent: "$0.00",
          income: "$0.00",
          topPayees: [],
          topCategories: [],
        },
      },
      connectorId: financeConn.id,
      needsSync: true,
      payeeFilter,
    };
  }

  const start = range.startDate;
  const end = range.endDate;
  const payeeLower = payeeFilter?.toLowerCase() ?? null;

  const txns = rows
    .map((row) => {
      const meta = row.recordMetadata ?? {};
      const amount = typeof meta.amount === "number" ? meta.amount : Number(meta.amount);
      if (!Number.isFinite(amount)) return null;
      const date =
        (typeof meta.date === "string" && meta.date) ||
        (row.sourceCreatedAt ? row.sourceCreatedAt.toISOString().slice(0, 10) : "");
      if (start && (!date || date < start)) return null;
      if (end && (!date || date > end)) return null;
      const payee = typeof meta.payee === "string" ? meta.payee : null;
      if (payeeLower && !(payee ?? "").toLowerCase().includes(payeeLower)) return null;
      return {
        amount,
        payee,
        category: typeof meta.category === "string" ? meta.category : null,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t != null);

  const labelParts = [range.label, payeeFilter ? `at ${payeeFilter}` : null].filter(Boolean);
  const finance = aggregateFinance(txns, labelParts.length ? labelParts.join(" ") : null);

  return {
    finance,
    connectorId: financeConn.id,
    needsSync: false,
    payeeFilter,
  };
}
