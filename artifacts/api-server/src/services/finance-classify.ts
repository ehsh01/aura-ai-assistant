/**
 * Deterministic finance transaction classification for spend integrity.
 * Prefer MyFamilyBudget metadata (type / affects* / transferSubtype), then payee heuristics.
 */

export type FinanceTxnKind =
  | "expense"
  | "income"
  | "transfer"
  | "credit_card_payment"
  | "refund";

export type FinanceTxnInput = {
  amount: number;
  payee?: string | null;
  category?: string | null;
  /** MFB: expense | income | transfer */
  type?: string | null;
  transferSubtype?: string | null;
  affectsSpending?: boolean | string | null;
  affectsIncome?: boolean | string | null;
  notes?: string | null;
};

/** Bank → card payments mislabeled as expense in MFB. */
const CC_PAYMENT_PAYEE =
  /\b(credit\s*crd|credit\s*card|crd\s*epay|epay)\b|\bpayment\s+to\s+.{0,48}card\s+ending\b|\bpayment\s+thank\s+you\b/i;

/** Clear internal / peer transfers (not store purchases). */
const TRANSFER_PAYEE =
  /\b(internal\s+transfer|category\s+transfer|transfer\s+to\s+savings|transfer\s+from\s+savings)\b/i;

/** Merchant refunds / returns. */
const REFUND_PAYEE = /\b(refund|return(?:ed)?|reversal|chargeback)\b/i;

function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return null;
}

function normalizeType(type: string | null | undefined): string | null {
  if (!type || typeof type !== "string") return null;
  return type.trim().toLowerCase() || null;
}

function normalizeSubtype(sub: string | null | undefined): string | null {
  if (!sub || typeof sub !== "string") return null;
  return sub.trim().toLowerCase() || null;
}

/**
 * Classify a synced finance transaction for aggregation.
 * Sign alone is not enough — CC payments and transfers must not inflate "spent".
 */
export function classifyFinanceTransaction(tx: FinanceTxnInput): FinanceTxnKind {
  const payee = (tx.payee ?? "").trim();
  const category = (tx.category ?? "").trim();
  const notes = (tx.notes ?? "").trim();
  const haystack = `${payee} ${category} ${notes}`;
  const type = normalizeType(tx.type);
  const subtype = normalizeSubtype(tx.transferSubtype);
  const affectsSpending = asBool(tx.affectsSpending);
  const affectsIncome = asBool(tx.affectsIncome);
  const amount = tx.amount;

  if (subtype === "credit_card_payment" || CC_PAYMENT_PAYEE.test(haystack)) {
    return "credit_card_payment";
  }

  if (
    type === "transfer" ||
    subtype === "internal_transfer" ||
    subtype === "category_transfer" ||
    TRANSFER_PAYEE.test(haystack)
  ) {
    return "transfer";
  }

  if (REFUND_PAYEE.test(haystack) && amount > 0) {
    return "refund";
  }

  if (type === "income" || (affectsIncome === true && affectsSpending !== true)) {
    return "income";
  }

  if (type === "expense" || affectsSpending === true) {
    return "expense";
  }

  // Legacy / untyped rows: fall back to sign.
  if (amount < 0) return "expense";
  if (amount > 0) return "income";
  return "transfer";
}

export function countsTowardSpent(kind: FinanceTxnKind): boolean {
  return kind === "expense";
}

export function countsTowardIncome(kind: FinanceTxnKind): boolean {
  return kind === "income";
}

/** Refunds reduce spent when positive (money back). */
export function spentDeltaCents(kind: FinanceTxnKind, amountCents: number): number {
  if (kind === "expense" && amountCents < 0) return -amountCents;
  if (kind === "refund" && amountCents > 0) return -amountCents;
  return 0;
}

export function incomeDeltaCents(kind: FinanceTxnKind, amountCents: number): number {
  if (kind === "income" && amountCents > 0) return amountCents;
  return 0;
}

export type ClassificationCounts = Record<FinanceTxnKind, number>;

export function emptyClassificationCounts(): ClassificationCounts {
  return {
    expense: 0,
    income: 0,
    transfer: 0,
    credit_card_payment: 0,
    refund: 0,
  };
}

export function tallyClassification(kinds: FinanceTxnKind[]): ClassificationCounts {
  const counts = emptyClassificationCounts();
  for (const kind of kinds) counts[kind] += 1;
  return counts;
}
