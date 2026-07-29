import type { QueryFinanceAggregate } from "./ai";
import { config } from "../lib/config";
import {
  classifyFinanceTransaction,
  emptyClassificationCounts,
  incomeDeltaCents,
  spentDeltaCents,
  type FinanceTxnInput,
  type FinanceTxnKind,
} from "./finance-classify";

export const FINANCE_INTENT =
  /\b(spend|spent|spending|cost|costs?|paid|pay(?:ing)?|budget|transactions?|expenses?|income|earn(?:ed)?|money|dollars?|grocer|restaurant|bought|purchase|bill|\$)\b/i;

/** Ask wants every matching transaction listed, not just a total. */
export const FINANCE_BREAKDOWN_INTENT =
  /\b(breakdown|break\s*(it\s*)?down|details?|list(?:\s+them)?|itemize|itemi[sz]e|show(?:\s+me)?(?:\s+all)?(?:\s+the)?\s+transactions?|what (?:made|makes) up|where did .{0,40}(?:go|come from)|itemize|line[- ]?items?)\b/i;

/** “What do I know about X?” / contact-focused / family name questions. */
export const PERSON_INTENT =
  /\b(what do i know about|tell me about|who is|who'?s|what(?:'s| is) my|name of my|about\s+[A-Z]|about\s+my|contact for|contact with|my (?:wife|husband|spouse|son|daughter|sister|brother|mom|mother|dad|father|nephew|niece|aunt|uncle|cousin))\b/i;

/** Family / relationship questions that should pull Life Memory (domain=family). */
export const FAMILY_RELATION_INTENT =
  /\b(wife|husband|spouse|son|daughter|sister|brother|mom|mother|dad|father|nephew|niece|aunt|uncle|cousin|kids|children|family|boyfriend|girlfriend|grandson|granddaughter|grandchild|in-?laws?)\b/i;

export const WAITING_INTENT =
  /\b(waiting|follow[- ]?up|awaiting|who.*(owe|owed|pending)|what.*(pending|waiting)|(has(n'?t| not)|did(n'?t| not)|never)\s+(reply|replied|respond|responded|get back|gotten back)|(haven'?t|have not|still no)\s+heard back|no (reply|response) (from|yet))\b/i;

/**
 * Deadline / what's-due questions — answered deterministically from
 * attention_items. Keep deadline-ish nouns required so family questions
 * ("when is my wife's birthday") don't hijack this path.
 */
export const DEADLINE_INTENT =
  /\b(deadlines?|what'?s due|what is due|due (today|tomorrow|this week|soon)|any deadlines|coming up|upcoming (deadlines?|appointments?|events?|inspections?)|when (is|are)( the| my)? [^?.]{0,50}?(deadline|due date|due|inspection|hearing|court|filing|permit|renewal|expir\w+|appointment)|appointments? (today|tomorrow|this week|coming up))\b/i;

/** Capability question with no search topic; do not misreport an empty corpus. */
export const NOTE_CAPABILITY_INTENT =
  /^\s*(?:can|could|would|will|are)\s+you\s+(?:able\s+to\s+)?(?:check|search|read|review|look\s+(?:at|in|through))\s+(?:(?:my|the)\s+)?notes?\s*[?.!]*\s*$/i;

/**
 * Morning-briefing / day-planning questions — answered deterministically from
 * the same briefing builders that power Today. Keep "focus/prioritize/plan"
 * anchored to day words so generic "focus on the project" requests don't match.
 */
export const BLOCKING_INTENT =
  /\b(what (?:is|'?s) blocking|blockers? (?:on|for|in)|what'?s (?:stuck|held up|holding up)|holding (?:up|back))\b/i;
export const PROMISES_INTENT =
  /\b(what (?:did|have) i promis(?:e|ed)|my (?:commitments|promises) to|what do i owe)\b/i;
export const DECISIONS_INTENT =
  /\b(recent decisions|decisions (?:for|on|about)|what (?:was|has been) decided)\b/i;
export const PERSON_DOSSIER_INTENT = /\bwhat do i need to know about\b/i;

/** Longest project name that appears as whole words in the question. */
export function mentionedProject<T extends { id: string; name: string }>(
  question: string,
  projects: T[],
): T | null {
  const candidates = projects
    .filter((p) => p.name.trim().length >= 4)
    .sort((a, b) => b.name.length - a.name.length);
  for (const p of candidates) {
    const escaped = p.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(question)) return p;
  }
  return null;
}

export const BRIEFING_INTENT =
  /\b(what should i (focus on|do|prioritize) today|morning briefing|daily briefing|my (day|briefing) (today|looks like)|what'?s (on|the plan) (for )?today|plan (for )?(my )?day|prioritize my day|what'?s today looking like|what do i have today)\b/i;

/** Evening check-in / tomorrow-prep questions. */
export const EVENING_INTENT =
  /\b(what did i (not finish|miss|get done|complete|accomplish) today|what'?s left (today|tonight|undone)|evening check[- ]?in|wrap up (my )?day|what should i prepare for tomorrow|what'?s (on|coming up) (for )?tomorrow|tomorrow'?s (schedule|deadlines|meetings)|prepare for tomorrow)\b/i;

export function recallTimezone(): string {
  return process.env.RECALL_TIMEZONE?.trim() || "America/New_York";
}

export function todayIso(now: Date = new Date()): string {
  const tz = recallTimezone();
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

/**
 * Human-readable instant in the user's timezone for Ask / Gmail context.
 * Keep this short and unambiguous so models cite it instead of inventing noon.
 */
export function formatInstantForUser(
  value: string | Date | null | undefined,
): string | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const tz = recallTimezone();
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/** Full local "now" label so the model can refuse future-looking email times. */
export function nowLocalLabel(now: Date = new Date()): string {
  return formatInstantForUser(now) ?? now.toISOString();
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
  // Must run before the bare "yesterday" match ("day before yesterday" contains it).
  if (/\bday before yesterday\b|\b2 days ago\b|\btwo days ago\b/.test(q)) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 2);
    const day = d.toISOString().slice(0, 10);
    return { startDate: day, endDate: day, label: "the day before yesterday" };
  }
  if (/\byesterday\b/.test(q)) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    const yday = d.toISOString().slice(0, 10);
    return { startDate: yday, endDate: yday, label: "yesterday" };
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

export type AggregateFinanceTxn = FinanceTxnInput & {
  date?: string;
};

export type AggregateFinanceOptions = {
  /** Override config.financeExcludeTransfers for tests / rollback. */
  excludeTransfers?: boolean;
};

/**
 * Aggregate finance totals. When excludeTransfers is on (default via config),
 * transfers and credit-card payments are omitted from spent/income/net.
 */
export function aggregateFinance(
  transactions: AggregateFinanceTxn[],
  rangeLabel: string | null,
  options?: AggregateFinanceOptions,
): QueryFinanceAggregate {
  const excludeTransfers = options?.excludeTransfers ?? config.financeExcludeTransfers;
  const byPayee = new Map<string, { totalCents: number; count: number }>();
  const byCategory = new Map<string, { totalCents: number; count: number }>();
  let netCents = 0;
  let spentCents = 0;
  let incomeCents = 0;
  let expenseCount = 0;
  let incomeCount = 0;
  const classificationCounts = emptyClassificationCounts();

  for (const tx of transactions) {
    const cents = toCents(tx.amount);
    const kind: FinanceTxnKind = excludeTransfers
      ? classifyFinanceTransaction(tx)
      : tx.amount < 0
        ? "expense"
        : tx.amount > 0
          ? "income"
          : "transfer";
    classificationCounts[kind] += 1;

    if (excludeTransfers) {
      spentCents += spentDeltaCents(kind, cents);
      if (kind === "expense" && cents < 0) expenseCount += 1;
      const incomeDelta = incomeDeltaCents(kind, cents);
      if (incomeDelta !== 0) {
        incomeCents += incomeDelta;
        incomeCount += 1;
      }
      // Net from real cash-flow only (expenses + income + refunds).
      if (kind === "expense" || kind === "income" || kind === "refund") {
        netCents += cents;
      }
    } else {
      netCents += cents;
      if (cents < 0) {
        spentCents += -cents;
        expenseCount += 1;
      } else if (cents > 0) {
        incomeCents += cents;
        incomeCount += 1;
      }
    }

    const includeInRanks =
      !excludeTransfers || kind === "expense" || kind === "income" || kind === "refund";
    if (!includeInRanks) continue;

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
  const spent = fromCents(Math.max(0, spentCents));
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
    transactions: [],
    transfersExcluded: excludeTransfers,
    classificationCounts,
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
