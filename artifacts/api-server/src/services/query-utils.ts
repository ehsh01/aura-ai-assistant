import type { QueryFinanceAggregate } from "./ai";

export const FINANCE_INTENT =
  /\b(spend|spent|spending|cost|costs?|paid|pay(?:ing)?|budget|transactions?|expenses?|income|earn(?:ed)?|money|dollars?|grocer|restaurant|bought|purchase|bill|\$)\b/i;

/** “What do I know about X?” / contact-focused / family name questions. */
export const PERSON_INTENT =
  /\b(what do i know about|tell me about|who is|who'?s|what(?:'s| is) my|name of my|about\s+[A-Z]|about\s+my|contact for|contact with|my (?:wife|husband|spouse|son|daughter|sister|brother|mom|mother|dad|father|nephew|niece|aunt|uncle|cousin))\b/i;

/** Family / relationship questions that should pull Life Memory (domain=family). */
export const FAMILY_RELATION_INTENT =
  /\b(wife|husband|spouse|son|daughter|sister|brother|mom|mother|dad|father|nephew|niece|aunt|uncle|cousin|kids|children|family|boyfriend|girlfriend|grandson|granddaughter|grandchild|in-?laws?)\b/i;

export const WAITING_INTENT =
  /\b(waiting|follow[- ]?up|awaiting|who.*(owe|owed|pending)|what.*(pending|waiting))\b/i;

export function todayIso(now: Date = new Date()): string {
  const tz = process.env.RECALL_TIMEZONE?.trim() || "America/New_York";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Exact money string with cents (e.g. -$12.80, $1,551.12). */
export function formatMoney(amount: number): string {
  const cents = Math.round(amount * 100);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const body = `${dollars.toLocaleString("en-US")}.${String(rem).padStart(2, "0")}`;
  return neg ? `-$${body}` : `$${body}`;
}

/** Convert to integer cents to avoid float drift when summing. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Which finance figure the question is asking for.
 * Spend questions must NOT use net (income − expenses).
 */
export function financeMetricForQuestion(
  question: string,
): "spent" | "income" | "net" {
  const q = question.toLowerCase();
  if (/\b(income|earn(?:ed|ings)?|paycheck|salary|deposited|received)\b/.test(q)) {
    return "income";
  }
  if (
    /\b(net|balance|left over|remaining|profit|cash\s*flow|cashflow)\b/.test(q)
  ) {
    return "net";
  }
  if (
    /\b(spend|spent|spending|expense|expenses|cost|costs?|paid|pay(?:ing)?|bought|purchase|grocer|restaurant|bill|budget|money|dollars?|transactions?)\b/.test(
      q,
    )
  ) {
    return "spent";
  }
  return "net";
}

/** Resolve relative time phrases in the question to an absolute date range. */
export function parseDateRange(
  question: string,
  today: string,
): { startDate?: string; endDate?: string; label: string | null } {
  const [y, m] = today.split("-").map(Number);
  const q = question.toLowerCase();
  const pad = (n: number) => String(n).padStart(2, "0");

  if (/\blast month\b/.test(q)) {
    const lm = m === 1 ? 12 : m! - 1;
    const ly = m === 1 ? y! - 1 : y!;
    const lastDay = new Date(Date.UTC(ly, lm, 0)).getUTCDate();
    return {
      startDate: `${ly}-${pad(lm)}-01`,
      endDate: `${ly}-${pad(lm)}-${pad(lastDay)}`,
      label: "last month",
    };
  }
  if (/\bthis month\b|\bthis month'?s\b/.test(q)) {
    return { startDate: `${y}-${pad(m!)}-01`, endDate: today, label: "this month" };
  }
  if (/\bthis year\b/.test(q)) {
    return { startDate: `${y}-01-01`, endDate: today, label: "this year" };
  }
  if (/\b(today|due today)\b/.test(q)) {
    return { startDate: today, endDate: today, label: "today" };
  }
  if (/\b(this week|past week|last week|last 7 days)\b/.test(q)) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return { startDate: d.toISOString().slice(0, 10), endDate: today, label: "the last 7 days" };
  }
  return { label: null };
}

/**
 * Default undated finance questions to this month so Ask doesn't sum all-time history.
 */
export function parseFinanceDateRange(
  question: string,
  today: string,
): { startDate?: string; endDate?: string; label: string | null } {
  const range = parseDateRange(question, today);
  if (range.startDate || range.endDate) return range;
  return parseDateRange("this month", today);
}

export function aggregateFinance(
  transactions: { amount: number; payee?: string | null; category?: string | null }[],
  rangeLabel: string | null,
): QueryFinanceAggregate {
  const byPayee = new Map<string, { totalCents: number; count: number }>();
  const byCategory = new Map<string, { totalCents: number; count: number }>();
  let netCents = 0;
  let spentCents = 0;
  let incomeCents = 0;
  let expenseCount = 0;
  let incomeCount = 0;

  for (const tx of transactions) {
    const cents = toCents(tx.amount);
    netCents += cents;
    if (cents < 0) {
      spentCents += -cents;
      expenseCount += 1;
    } else if (cents > 0) {
      incomeCents += cents;
      incomeCount += 1;
    }
    const payee = (tx.payee ?? "Unknown").trim() || "Unknown";
    const category = (tx.category ?? "Uncategorized").trim() || "Uncategorized";
    const p = byPayee.get(payee) ?? { totalCents: 0, count: 0 };
    p.totalCents += cents;
    p.count += 1;
    byPayee.set(payee, p);
    const c = byCategory.get(category) ?? { totalCents: 0, count: 0 };
    c.totalCents += cents;
    c.count += 1;
    byCategory.set(category, c);
  }

  const rank = (map: Map<string, { totalCents: number; count: number }>) =>
    [...map.entries()]
      .sort((a, b) => Math.abs(b[1].totalCents) - Math.abs(a[1].totalCents))
      .slice(0, 10);

  const total = fromCents(netCents);
  const spent = fromCents(spentCents);
  const income = fromCents(incomeCents);
  const topPayees = rank(byPayee).map(([payee, v]) => ({
    payee,
    total: fromCents(v.totalCents),
    count: v.count,
  }));
  const topCategories = rank(byCategory)
    .slice(0, 8)
    .map(([category, v]) => ({
      category,
      total: fromCents(v.totalCents),
      count: v.count,
    }));

  return {
    total,
    spent,
    income,
    count: transactions.length,
    expenseCount,
    incomeCount,
    rangeLabel,
    topPayees,
    topCategories,
    formatted: {
      net: formatMoney(total),
      spent: formatMoney(spent),
      income: formatMoney(income),
      topPayees: topPayees.map((p) => ({
        payee: p.payee,
        total: formatMoney(p.total),
        count: p.count,
      })),
      topCategories: topCategories.map((c) => ({
        category: c.category,
        total: formatMoney(c.total),
        count: c.count,
      })),
    },
  };
}

/** Pick the primary amount + label for an answer sentence. */
export function primaryFinanceFigure(
  finance: QueryFinanceAggregate,
  metric: "spent" | "income" | "net",
): { amount: number; formatted: string; label: string } {
  if (metric === "spent") {
    return { amount: finance.spent, formatted: finance.formatted.spent, label: "spent" };
  }
  if (metric === "income") {
    return { amount: finance.income, formatted: finance.formatted.income, label: "income" };
  }
  return { amount: finance.total, formatted: finance.formatted.net, label: "net" };
}
