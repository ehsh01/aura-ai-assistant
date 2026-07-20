import { and, desc, eq } from "drizzle-orm";
import { sourceRecords } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { config } from "../lib/config";
import { logger } from "../lib/logger";
import { listConnectorsForUser } from "./connectors";
import { classifyFinanceTransaction } from "./finance-classify";
import { aggregateFinance, formatMoney, parseFinanceDateRange } from "./query-utils";
import type { QueryFinanceAggregate } from "./ai";

export type SyncedFinanceResult = {
  finance: QueryFinanceAggregate;
  connectorId: string;
  needsSync: boolean;
  payeeFilter: string | null;
};

export function financeSummaryFromSynced(result: SyncedFinanceResult): {
  total: number;
  transactionCount: number;
  transactions: {
    id: string;
    date: string;
    amount: number;
    payee: string | null;
    category: string | null;
    notes: null;
  }[];
  evidenceNote: string;
} {
  const expenses = result.finance.transactions.filter((tx) => {
    if (tx.kind) return tx.kind === "expense";
    return tx.amount < 0;
  });
  const excludedNote = result.finance.transfersExcluded
    ? " Transfers and credit-card payments are excluded from spent."
    : "";
  return {
    total: result.finance.spent,
    transactionCount: result.finance.expenseCount,
    transactions: expenses.map((tx, index) => ({
      id: `synced-${tx.date}-${index}`,
      date: tx.date,
      amount: tx.amount,
      payee: tx.payee,
      category: tx.category,
      notes: null,
    })),
    evidenceNote: `Spent total computed from ${result.finance.expenseCount} synced transaction(s) for ${result.finance.rangeLabel ?? "the selected period"}.${excludedNote} Last successful sync is the source snapshot.`,
  };
}

// Generic words that regularly follow "spend"/"spent"/"pay" in ordinary
// phrasing but are never merchant names on their own (e.g. "did I spend
// *any* money today?", "did I spend *anything*?"). Treating one of these as
// a payee filter used to silently zero out every real transaction because
// no payee literally contains the word "any" — the answer would then
// (wrongly) report $0 spent with full confidence. Every word making up the
// candidate must fail this check for it to be trusted as a real merchant.
const PAYEE_STOPWORDS = new Set([
  "last",
  "this",
  "the",
  "my",
  "a",
  "an",
  "month",
  "week",
  "year",
  "today",
  "yesterday",
  "money",
  "cash",
  "any",
  "anything",
  "something",
  "some",
  "much",
  "more",
  "extra",
  "it",
  "on",
  "for",
  "in",
  "of",
  "up",
  "out",
  "else",
  "so",
  "too",
  "many",
  "lot",
  "lots",
  "all",
  "that",
  "those",
  "these",
  "things",
  "stuff",
  "dollar",
  "dollars",
]);

/** True when every word in a candidate merchant match is a generic filler word. */
function isPayeeStopPhrase(raw: string): boolean {
  const words = raw.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length === 0 || words.every((w) => PAYEE_STOPWORDS.has(w));
}

/**
 * Pull a likely payee/merchant name out of a spending question.
 * Both patterns require an actual preposition (at/on/to/from/with/for) right
 * before the candidate word. A prior version let the second pattern grab
 * *any* bare word immediately after "spent"/"paid" with no preposition —
 * that swallowed typos of date words ("how much did I spent yeaterday in
 * total" -> payee "yeaterday") and fillers ("did I spend any money" ->
 * payee "any") as if they were merchant names, silently zeroing out every
 * real transaction and reporting "you did not spend any money" at full
 * confidence. Requiring a preposition (plus the stopword guard below) means
 * an unrecognized word is left as "no merchant filter" instead of a bogus
 * one — missing a real filter is far safer than fabricating one.
 */
export function extractPayeeHint(question: string): string | null {
  const patterns = [
    /\b(?:at|from|to|with|on)\s+([A-Za-z0-9&.'\-\s]{2,40}?)(?:\s+(?:last|this|in|for|during|on)\b|[?.!]|$)/i,
    /\b(?:spent|spend|spending|paid|pay|bought|purchase(?:d)?)\s+(?:at|on|for|to|from|with)\s+([A-Za-z0-9&.'\-]{2,40})\b/i,
  ];
  for (const re of patterns) {
    const m = question.match(re);
    const raw = m?.[1]?.trim();
    if (!raw) continue;
    if (isPayeeStopPhrase(raw)) continue;
    return raw.replace(/\s+/g, " ").slice(0, 60);
  }
  return null;
}

const emptyFinance = (rangeLabel: string | null): QueryFinanceAggregate => ({
  total: 0,
  spent: 0,
  income: 0,
  count: 0,
  expenseCount: 0,
  incomeCount: 0,
  rangeLabel,
  topPayees: [],
  topCategories: [],
  formatted: {
    net: "$0.00",
    spent: "$0.00",
    income: "$0.00",
    topPayees: [],
    topCategories: [],
  },
  transactions: [],
  transfersExcluded: config.financeExcludeTransfers,
  classificationCounts: {
    expense: 0,
    income: 0,
    transfer: 0,
    credit_card_payment: 0,
    refund: 0,
  },
});

/**
 * Aggregate finance from already-synced source_records.
 * Prefer this over live external API calls for Ask/Home.
 */
export async function loadSyncedFinanceAggregate(
  userId: string,
  question: string,
  today: string,
  options?: {
    connectorId?: string;
    startDate?: string;
    endDate?: string;
    payee?: string;
    /** When true, never extract a payee from the question (empty-filter distrust). */
    skipPayeeHint?: boolean;
  },
): Promise<SyncedFinanceResult | null> {
  const connectors = await listConnectorsForUser(userId);
  const financeConn = connectors.find(
    (c) =>
      c.type === "finance_api" &&
      (!options?.connectorId || c.id === options.connectorId),
  );
  if (!financeConn) return null;

  const parsedRange = parseFinanceDateRange(question, today);
  const hasExplicitRange = Boolean(options?.startDate || options?.endDate);
  const range = hasExplicitRange
    ? {
        startDate: options?.startDate ?? null,
        endDate: options?.endDate ?? null,
        label: [options?.startDate, options?.endDate].filter(Boolean).join(" to "),
      }
    : parsedRange;
  const payeeFilter = options?.skipPayeeHint
    ? null
    : options?.payee?.trim() || extractPayeeHint(question);

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
      finance: emptyFinance(range.label),
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
        date,
        amount,
        payee,
        category: typeof meta.category === "string" ? meta.category : null,
        type: typeof meta.type === "string" ? meta.type : null,
        transferSubtype:
          typeof meta.transferSubtype === "string" ? meta.transferSubtype : null,
        affectsSpending:
          typeof meta.affectsSpending === "boolean" || typeof meta.affectsSpending === "string"
            ? meta.affectsSpending
            : null,
        affectsIncome:
          typeof meta.affectsIncome === "boolean" || typeof meta.affectsIncome === "string"
            ? meta.affectsIncome
            : null,
        notes: typeof meta.notes === "string" ? meta.notes : null,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t != null);

  const labelParts = [range.label, payeeFilter ? `at ${payeeFilter}` : null].filter(Boolean);
  const finance = aggregateFinance(txns, labelParts.length ? labelParts.join(" ") : null);

  if (finance.classificationCounts) {
    logger.info(
      {
        userId,
        connectorId: financeConn.id,
        excludeTransfers: config.financeExcludeTransfers,
        rangeLabel: finance.rangeLabel,
        counts: finance.classificationCounts,
        spent: finance.spent,
        income: finance.income,
      },
      "finance.classification",
    );
  }

  // Newest first; keep a generous cap so breakdown answers can list everything practical.
  const MAX_TX_LINES = 300;
  const excludeTransfers = finance.transfersExcluded ?? config.financeExcludeTransfers;
  finance.transactions = txns
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, MAX_TX_LINES)
    .map((t) => {
      const kind = excludeTransfers
        ? classifyFinanceTransaction(t)
        : t.amount < 0
          ? ("expense" as const)
          : t.amount > 0
            ? ("income" as const)
            : ("transfer" as const);
      return {
        date: t.date,
        payee: (t.payee ?? "Unknown").trim() || "Unknown",
        amount: t.amount,
        amountFormatted: formatMoney(t.amount),
        category: t.category,
        kind,
      };
    });

  return {
    finance,
    connectorId: financeConn.id,
    needsSync: false,
    payeeFilter,
  };
}
