import type { QueryFinanceAggregate } from "./ai";

export const FINANCE_INTENT =
  /\b(spend|spent|spending|cost|costs?|paid|pay(?:ing)?|budget|transactions?|expenses?|income|earn(?:ed)?|money|dollars?|grocer|restaurant|bought|purchase|bill|\$)\b/i;

/** “What do I know about X?” / contact-focused / family name questions. */
export const PERSON_INTENT =
  /\b(what do i know about|tell me about|who is|who'?s|what(?:'s| is) my|name of my|about\s+[A-Z]|about\s+my|contact for|contact with|my (?:wife|husband|spouse|son|daughter|sister|brother|mom|mother|dad|father|nephew|niece|aunt|uncle|cousin))\b/i;

/** Family / relationship questions that should pull Life Memory (domain=family). */
export const FAMILY_RELATION_INTENT =
  /\b(wife|husband|spouse|son|daughter|sister|brother|mom|mother|dad|father|nephew|niece|aunt|uncle|cousin|kids|children|family|boyfriend|girlfriend|in-?laws?)\b/i;

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

export function aggregateFinance(
  transactions: { amount: number; payee?: string | null; category?: string | null }[],
  rangeLabel: string | null,
): QueryFinanceAggregate {
  const byPayee = new Map<string, { total: number; count: number }>();
  const byCategory = new Map<string, { total: number; count: number }>();
  let total = 0;
  for (const tx of transactions) {
    total += tx.amount;
    const payee = (tx.payee ?? "Unknown").trim() || "Unknown";
    const category = (tx.category ?? "Uncategorized").trim() || "Uncategorized";
    const p = byPayee.get(payee) ?? { total: 0, count: 0 };
    p.total += tx.amount;
    p.count += 1;
    byPayee.set(payee, p);
    const c = byCategory.get(category) ?? { total: 0, count: 0 };
    c.total += tx.amount;
    c.count += 1;
    byCategory.set(category, c);
  }
  const rank = (map: Map<string, { total: number; count: number }>) =>
    [...map.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total)).slice(0, 10);
  return {
    total: Number(total.toFixed(2)),
    count: transactions.length,
    rangeLabel,
    topPayees: rank(byPayee).map(([payee, v]) => ({
      payee,
      total: Number(v.total.toFixed(2)),
      count: v.count,
    })),
    topCategories: rank(byCategory)
      .slice(0, 8)
      .map(([category, v]) => ({ category, total: Number(v.total.toFixed(2)), count: v.count })),
  };
}
