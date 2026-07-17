import { describe, expect, it } from "vitest";
import {
  extractReceiptAmounts,
  extractReceiptDates,
  scoreReceiptMatch,
} from "./receipt-match";

describe("receipt match heuristics", () => {
  it("extracts amounts and dates from receipt text", () => {
    const text = "Home Depot 03/15/2026 Total $84.32 Thank you";
    expect(extractReceiptAmounts(text)).toContain(84.32);
    expect(extractReceiptDates(text)).toContain("2026-03-15");
  });

  it("scores exact amount + date + payee highly", () => {
    const { score, reasons } = scoreReceiptMatch({
      receiptAmounts: [84.32],
      receiptDates: ["2026-03-15"],
      receiptText: "HOME DEPOT #1234 aisle 12",
      amount: -84.32,
      date: "2026-03-15",
      payee: "HOME DEPOT #1234",
    });
    expect(score).toBeGreaterThanOrEqual(8);
    expect(reasons.some((r) => r.includes("amount"))).toBe(true);
    expect(reasons.some((r) => r.includes("date"))).toBe(true);
  });
});
