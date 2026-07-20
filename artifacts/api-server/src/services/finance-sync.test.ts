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

  it("does not treat 'any' as a merchant (false $0 spent bug)", () => {
    expect(extractPayeeHint("did I spend any money today?")).toBeNull();
  });

  it("does not treat 'anything' as a merchant", () => {
    expect(extractPayeeHint("did I spend anything today?")).toBeNull();
  });

  it("does not treat a trailing filler word as a merchant", () => {
    expect(extractPayeeHint("how much have I spent this week?")).toBeNull();
  });

  it("finds the real merchant after 'spend on'", () => {
    expect(extractPayeeHint("how much did I spend on Amazon this month?")).toBe(
      "Amazon",
    );
  });

  it("does not treat 'at all' as a merchant", () => {
    expect(extractPayeeHint("did I spend at all today?")).toBeNull();
  });

  it("does not treat a typo of a date word as a merchant (real production bug)", () => {
    // Actual user question that triggered "You did not spend any money
    // yesterday." even though the day had real transactions — "yeaterday"
    // isn't a preposition-led merchant, so it must not become a payee filter.
    expect(
      extractPayeeHint("how much money did i spent yeaterday in total"),
    ).toBeNull();
  });

  it("requires a preposition, not just any bare word after 'spend'", () => {
    expect(extractPayeeHint("how much did I spend groceries this week")).toBeNull();
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
