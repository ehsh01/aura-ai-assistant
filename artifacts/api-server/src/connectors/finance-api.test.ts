import { describe, expect, it } from "vitest";
import { buildFinanceUrl, sumTransactions } from "./finance-api";

describe("buildFinanceUrl", () => {
  it("preserves the base path (regression: dropped /api/v1)", () => {
    expect(buildFinanceUrl("https://myfamilybudget.net/api/v1")).toBe(
      "https://myfamilybudget.net/api/v1/transactions",
    );
  });

  it("trims a trailing slash on the base", () => {
    expect(buildFinanceUrl("https://host/api/v1/")).toBe("https://host/api/v1/transactions");
  });

  it("appends date range query params", () => {
    const url = new URL(
      buildFinanceUrl("https://host/api/v1", { startDate: "2026-07-01", endDate: "2026-07-31" }),
    );
    expect(url.pathname).toBe("/api/v1/transactions");
    expect(url.searchParams.get("startDate")).toBe("2026-07-01");
    expect(url.searchParams.get("endDate")).toBe("2026-07-31");
  });
});

describe("sumTransactions", () => {
  it("sums amounts including negatives", () => {
    expect(sumTransactions([
      { id: "1", date: "2026-07-01", amount: -10 },
      { id: "2", date: "2026-07-02", amount: -5.5 },
      { id: "3", date: "2026-07-03", amount: 100 },
    ])).toBe(84.5);
  });

  it("returns 0 for empty input", () => {
    expect(sumTransactions([])).toBe(0);
  });
});
