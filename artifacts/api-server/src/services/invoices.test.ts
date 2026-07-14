import { describe, expect, it } from "vitest";
import { findAttentionInvoices } from "./invoices";

describe("findAttentionInvoices", () => {
  it("surfaces open invoices due soon", () => {
    const found = findAttentionInvoices(
      [
        {
          id: "i1",
          title: "Roof deposit",
          status: "open",
          dueDate: "2026-07-20",
          amountCents: 250000,
          currency: "USD",
          organizationName: "ABC Roofing",
        },
        {
          id: "i2",
          title: "Paid already",
          status: "paid",
          dueDate: "2026-07-15",
        },
        {
          id: "i3",
          title: "Far out",
          status: "open",
          dueDate: "2027-01-01",
        },
      ],
      { todayIso: "2026-07-13", upcomingDays: 30, pastGraceDays: 60 },
    );
    expect(found.map((i) => i.id)).toEqual(["i1"]);
    expect(found[0]?.daysUntil).toBe(7);
    expect(found[0]?.amountLabel).toBe("USD 2500.00");
  });

  it("includes recently overdue open invoices", () => {
    const found = findAttentionInvoices(
      [{ id: "i1", title: "Permit fee", status: "open", dueDate: "2026-07-01" }],
      { todayIso: "2026-07-13", upcomingDays: 30, pastGraceDays: 60 },
    );
    expect(found[0]).toEqual(expect.objectContaining({ id: "i1", daysUntil: -12 }));
  });
});
