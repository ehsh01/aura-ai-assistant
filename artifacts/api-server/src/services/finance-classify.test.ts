import { describe, expect, it } from "vitest";
import {
  classifyFinanceTransaction,
  incomeDeltaCents,
  spentDeltaCents,
} from "./finance-classify";

describe("classifyFinanceTransaction", () => {
  it("classifies store purchases as expense", () => {
    expect(
      classifyFinanceTransaction({
        amount: -84.32,
        payee: "PUBLIX #1234",
        type: "expense",
        affectsSpending: true,
      }),
    ).toBe("expense");
  });

  it("classifies MFB transferSubtype credit_card_payment", () => {
    expect(
      classifyFinanceTransaction({
        amount: 500,
        payee: "Payment Thank You-Mobile",
        type: "transfer",
        transferSubtype: "credit_card_payment",
        affectsSpending: false,
        affectsIncome: false,
      }),
    ).toBe("credit_card_payment");
  });

  it("reclassifies Chase EPAY expense as credit_card_payment", () => {
    expect(
      classifyFinanceTransaction({
        amount: -900,
        payee: "CHASE CREDIT CRD EPAY",
        type: "expense",
        affectsSpending: true,
      }),
    ).toBe("credit_card_payment");
  });

  it("reclassifies Payment to Chase card as credit_card_payment", () => {
    expect(
      classifyFinanceTransaction({
        amount: -807,
        payee: "Payment to Chase card ending in 7612 03/25",
        type: "expense",
        affectsSpending: true,
      }),
    ).toBe("credit_card_payment");
  });

  it("classifies typed transfers as transfer", () => {
    expect(
      classifyFinanceTransaction({
        amount: -200,
        payee: "Savings",
        type: "transfer",
        transferSubtype: "internal_transfer",
        affectsSpending: false,
      }),
    ).toBe("transfer");
  });

  it("classifies income", () => {
    expect(
      classifyFinanceTransaction({
        amount: 2000,
        payee: "Employer",
        type: "income",
        affectsIncome: true,
        affectsSpending: false,
      }),
    ).toBe("income");
  });

  it("classifies refunds", () => {
    expect(
      classifyFinanceTransaction({
        amount: 40,
        payee: "AMAZON REFUND",
        type: "income",
      }),
    ).toBe("refund");
  });

  it("falls back to sign when untyped", () => {
    expect(classifyFinanceTransaction({ amount: -12, payee: "Cafe" })).toBe("expense");
    expect(classifyFinanceTransaction({ amount: 12, payee: "Gift" })).toBe("income");
  });
});

describe("spent/income deltas", () => {
  it("counts expenses toward spent and excludes CC payments", () => {
    expect(spentDeltaCents("expense", -5000)).toBe(5000);
    expect(spentDeltaCents("credit_card_payment", -90000)).toBe(0);
    expect(spentDeltaCents("transfer", -20000)).toBe(0);
    expect(spentDeltaCents("refund", 4000)).toBe(-4000);
  });

  it("counts income only for income kind", () => {
    expect(incomeDeltaCents("income", 200000)).toBe(200000);
    expect(incomeDeltaCents("credit_card_payment", 50000)).toBe(0);
    expect(incomeDeltaCents("refund", 4000)).toBe(0);
  });
});
