import { describe, expect, it } from "vitest";
import { aggregateFinance, FINANCE_INTENT, parseDateRange } from "./query-utils";

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
});

describe("aggregateFinance", () => {
  const txns = [
    { amount: -50, payee: "Publix", category: "Groceries" },
    { amount: -30, payee: "Publix", category: "Groceries" },
    { amount: -100, payee: "Shell", category: "Gas" },
    { amount: 2000, payee: "Employer", category: "Income" },
  ];

  it("sums the net total", () => {
    expect(aggregateFinance(txns, "this month").total).toBe(1820);
  });

  it("counts transactions", () => {
    expect(aggregateFinance(txns, null).count).toBe(4);
  });

  it("ranks payees by absolute total", () => {
    const agg = aggregateFinance(txns, null);
    expect(agg.topPayees[0]).toEqual({ payee: "Employer", total: 2000, count: 1 });
    const publix = agg.topPayees.find((p) => p.payee === "Publix");
    expect(publix).toEqual({ payee: "Publix", total: -80, count: 2 });
  });

  it("aggregates categories and falls back for missing values", () => {
    const agg = aggregateFinance([{ amount: -5 }], null);
    expect(agg.topCategories[0]).toEqual({ category: "Uncategorized", total: -5, count: 1 });
    expect(agg.topPayees[0]).toEqual({ payee: "Unknown", total: -5, count: 1 });
  });
});
