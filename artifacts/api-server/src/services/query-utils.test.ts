import { describe, expect, it } from "vitest";
import {
  aggregateFinance,
  FINANCE_BREAKDOWN_INTENT,
  FINANCE_INTENT,
  NOTE_CAPABILITY_INTENT,
  financeMetricForQuestion,
  formatInstantForUser,
  formatMoney,
  nowLocalLabel,
  parseDateRange,
  parseFinanceDateRange,
  primaryFinanceFigure,
  todayIso,
} from "./query-utils";

describe("formatInstantForUser", () => {
  it("formats UTC instants in America/New_York with clock time", () => {
    const prev = process.env.RECALL_TIMEZONE;
    process.env.RECALL_TIMEZONE = "America/New_York";
    try {
      const label = formatInstantForUser("2026-07-09T17:53:44.000Z");
      expect(label).toMatch(/Jul 9, 2026/);
      expect(label).toMatch(/1:53\s*PM/);
      expect(label).not.toMatch(/12:00/);
    } finally {
      if (prev === undefined) delete process.env.RECALL_TIMEZONE;
      else process.env.RECALL_TIMEZONE = prev;
    }
  });

  it("returns null for empty/invalid values", () => {
    expect(formatInstantForUser(null)).toBeNull();
    expect(formatInstantForUser("not-a-date")).toBeNull();
  });
});

describe("nowLocalLabel", () => {
  it("includes a clock time for today", () => {
    const label = nowLocalLabel(new Date("2026-07-14T13:42:00.000Z"));
    expect(label).toMatch(/2026/);
    expect(label).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("todayIso", () => {
  it("uses the configured timezone date", () => {
    const prev = process.env.RECALL_TIMEZONE;
    process.env.RECALL_TIMEZONE = "America/New_York";
    try {
      // 2026-07-14 02:00 UTC is still Jul 13 in New York.
      expect(todayIso(new Date("2026-07-14T02:00:00.000Z"))).toBe("2026-07-13");
    } finally {
      if (prev === undefined) delete process.env.RECALL_TIMEZONE;
      else process.env.RECALL_TIMEZONE = prev;
    }
  });
});

describe("NOTE_CAPABILITY_INTENT", () => {
  it("recognizes note capability questions without a search topic", () => {
    expect(NOTE_CAPABILITY_INTENT.test("can you check the notes")).toBe(true);
    expect(NOTE_CAPABILITY_INTENT.test("Could you search my notes?")).toBe(true);
    expect(NOTE_CAPABILITY_INTENT.test("Are you able to read my notes?")).toBe(true);
  });

  it("leaves actual note searches to retrieval", () => {
    expect(NOTE_CAPABILITY_INTENT.test("Check my notes for the Porsche VIN")).toBe(false);
    expect(NOTE_CAPABILITY_INTENT.test("Summarize my meeting notes")).toBe(false);
  });
});

describe("FINANCE_INTENT", () => {
  it("matches money-related questions", () => {
    for (const q of [
      "How much did I spend at Publix?",
      "What's my grocery budget this month?",
      "Show my transactions",
      "How much did I pay in bills?",
      "total cost of the trip",
    ]) {
      expect(FINANCE_INTENT.test(q)).toBe(true);
    }
  });

  it("ignores non-financial questions", () => {
    for (const q of ["What should I focus on today?", "Who did I meet with?", "Summarize my notes"]) {
      expect(FINANCE_INTENT.test(q)).toBe(false);
    }
  });
});

describe("parseDateRange", () => {
  const today = "2026-07-09";

  it("resolves 'this month'", () => {
    expect(parseDateRange("spend this month", today)).toEqual({
      startDate: "2026-07-01",
      endDate: today,
      label: "this month",
    });
  });

  it("resolves 'last month' including year rollover", () => {
    expect(parseDateRange("spend last month", today)).toEqual({
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      label: "last month",
    });
    expect(parseDateRange("spend last month", "2026-01-15")).toEqual({
      startDate: "2025-12-01",
      endDate: "2025-12-31",
      label: "last month",
    });
  });

  it("resolves 'this year' and 'today'", () => {
    expect(parseDateRange("income this year", today)).toEqual({
      startDate: "2026-01-01",
      endDate: today,
      label: "this year",
    });
    expect(parseDateRange("what is due today", today)).toEqual({
      startDate: today,
      endDate: today,
      label: "today",
    });
  });

  it("resolves rolling 7-day window", () => {
    expect(parseDateRange("spend this week", today)).toEqual({
      startDate: "2026-07-03",
      endDate: today,
      label: "the last 7 days",
    });
  });

  it("returns null label when no time phrase is present", () => {
    expect(parseDateRange("how much did I spend at Publix", today)).toEqual({ label: null });
  });

  it("defaults undated finance questions to this month", () => {
    expect(parseFinanceDateRange("how much did I spend at Publix", today)).toEqual({
      startDate: "2026-07-01",
      endDate: today,
      label: "this month",
    });
  });
});

describe("formatMoney / financeMetricForQuestion", () => {
  it("keeps exact cents including trailing zeros", () => {
    expect(formatMoney(72.8)).toBe("$72.80");
    expect(formatMoney(-12.81)).toBe("-$12.81");
    expect(formatMoney(1551.12)).toBe("$1,551.12");
    expect(formatMoney(0.01)).toBe("$0.01");
  });

  it("picks spent for spending questions and income for earnings", () => {
    expect(financeMetricForQuestion("How much did I spend this month?")).toBe("spent");
    expect(financeMetricForQuestion("What was my income last month?")).toBe("income");
    expect(financeMetricForQuestion("What is my net for this month?")).toBe("net");
  });

  it("detects breakdown questions", () => {
    expect(FINANCE_BREAKDOWN_INTENT.test("Give me a breakdown of that")).toBe(true);
    expect(FINANCE_BREAKDOWN_INTENT.test("Show me all the transactions")).toBe(true);
    expect(FINANCE_BREAKDOWN_INTENT.test("How much did I spend?")).toBe(false);
  });
});

describe("aggregateFinance", () => {
  const txns = [
    { amount: -50.25, payee: "Publix", category: "Groceries" },
    { amount: -30.1, payee: "Publix", category: "Groceries" },
    { amount: -100, payee: "Shell", category: "Gas" },
    { amount: 2000.5, payee: "Employer", category: "Income" },
  ];

  it("sums net, spent, and income with exact cents", () => {
    const agg = aggregateFinance(txns, "this month");
    expect(agg.total).toBe(1820.15);
    expect(agg.spent).toBe(180.35);
    expect(agg.income).toBe(2000.5);
    expect(agg.formatted.spent).toBe("$180.35");
    expect(agg.formatted.income).toBe("$2,000.50");
    expect(agg.formatted.net).toBe("$1,820.15");
    expect(agg.expenseCount).toBe(3);
    expect(agg.incomeCount).toBe(1);
  });

  it("counts transactions", () => {
    expect(aggregateFinance(txns, null).count).toBe(4);
  });

  it("ranks payees by absolute total", () => {
    const agg = aggregateFinance(txns, null);
    expect(agg.topPayees[0]).toEqual({ payee: "Employer", total: 2000.5, count: 1 });
    const publix = agg.topPayees.find((p) => p.payee === "Publix");
    expect(publix).toEqual({ payee: "Publix", total: -80.35, count: 2 });
  });

  it("aggregates categories and falls back for missing values", () => {
    const agg = aggregateFinance([{ amount: -5 }], null);
    expect(agg.topCategories[0]).toEqual({ category: "Uncategorized", total: -5, count: 1 });
    expect(agg.topPayees[0]).toEqual({ payee: "Unknown", total: -5, count: 1 });
  });

  it("primaryFinanceFigure prefers spent for spend questions", () => {
    const agg = aggregateFinance(txns, "this month");
    expect(primaryFinanceFigure(agg, "spent").formatted).toBe("$180.35");
  });
});
