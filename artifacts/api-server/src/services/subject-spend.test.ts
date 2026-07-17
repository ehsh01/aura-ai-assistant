import { describe, expect, it } from "vitest";
import { aggregateFinance } from "./query-utils";
import { classifyFinanceTransaction } from "./finance-classify";

describe("subject spend classification", () => {
  it("aggregates only real expenses for a linked subject set", () => {
    const linked = [
      {
        amount: -4200,
        payee: "ABC Drywall",
        category: "Construction",
        type: "expense",
        affectsSpending: true,
      },
      {
        amount: -900,
        payee: "CHASE CREDIT CRD EPAY",
        type: "expense",
        affectsSpending: true,
      },
      {
        amount: -85,
        payee: "Home Depot",
        category: "Home",
        type: "expense",
        affectsSpending: true,
      },
    ];
    const agg = aggregateFinance(linked, "Primary residence", { excludeTransfers: true });
    expect(agg.spent).toBe(4285);
    expect(agg.expenseCount).toBe(2);
    expect(classifyFinanceTransaction(linked[1]!)).toBe("credit_card_payment");
  });
});
