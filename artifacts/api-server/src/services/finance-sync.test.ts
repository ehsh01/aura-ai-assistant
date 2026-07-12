import { describe, expect, it } from "vitest";
import { aggregateFinance } from "./query-utils";
import { extractPayeeHint, financeSummaryFromSynced } from "./finance-sync";

describe("extractPayeeHint", () => {
  it("pulls merchant after 'at'", () => {
    expect(extractPayeeHint("How much did I spend at Publix last month?")).toBe("Publix");
  });

  it("pulls merchant after 'spent at'", () => {
    expect(extractPayeeHint("What did I spend at Shell this week")).toBe("Shell");
  });

  it("returns null when no merchant is present", () => {
    expect(extractPayeeHint("How much did I spend this month?")).toBeNull();
  });
});

describe("financeSummaryFromSynced", () => {
  it("uses the synced spending metric and excludes income rows", () => {
    const rows = [
      { date: "2026-07-10", amount: -20, payee: "Market", category: "Groceries" },
      { date: "2026-07-11", amount: 100, payee: "Payroll", category: "Income" },
      { date: "2026-07-12", amount: -5.5, payee: "Cafe", category: "Dining" },
    ];
    const finance = aggregateFinance(rows, "this month");
    finance.transactions = rows.map((row) => ({
      ...row,
      amountFormatted: `$${row.amount}`,
    }));

    const summary = financeSummaryFromSynced({
      finance,
      connectorId: "finance-1",
      needsSync: false,
      payeeFilter: null,
    });

    expect(summary.total).toBe(25.5);
    expect(summary.transactionCount).toBe(2);
    expect(summary.transactions.map((row) => row.payee)).toEqual(["Market", "Cafe"]);
    expect(summary.evidenceNote).toContain("synced");
    expect(summary.evidenceNote).toContain("this month");
  });
});
