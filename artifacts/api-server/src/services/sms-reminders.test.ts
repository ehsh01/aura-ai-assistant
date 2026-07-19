import { describe, expect, it } from "vitest";
import { planSmsSendsForItem } from "./sms-reminders";

describe("planSmsSendsForItem", () => {
  const dueAt = new Date("2026-07-19T18:00:00Z");

  it("sends the heads-up once inside the lead window and not sent yet", () => {
    const now = new Date("2026-07-19T17:45:00Z"); // 15 min before due, lead = 30
    const plan = planSmsSendsForItem(
      { dueAt, status: "open", smsHeadsUpSentAt: null, smsDueSentAt: null },
      now,
      30,
    );
    expect(plan).toEqual({ headsUp: true, dueNow: false });
  });

  it("does not send the heads-up before entering the lead window", () => {
    const now = new Date("2026-07-19T17:00:00Z"); // 60 min before due, lead = 30
    const plan = planSmsSendsForItem(
      { dueAt, status: "open", smsHeadsUpSentAt: null, smsDueSentAt: null },
      now,
      30,
    );
    expect(plan).toEqual({ headsUp: false, dueNow: false });
  });

  it("does not re-send the heads-up once already sent", () => {
    const now = new Date("2026-07-19T17:45:00Z");
    const plan = planSmsSendsForItem(
      { dueAt, status: "open", smsHeadsUpSentAt: new Date("2026-07-19T17:35:00Z"), smsDueSentAt: null },
      now,
      30,
    );
    expect(plan.headsUp).toBe(false);
  });

  it("sends the due-now text right at dueAt", () => {
    const now = dueAt;
    const plan = planSmsSendsForItem(
      { dueAt, status: "open", smsHeadsUpSentAt: null, smsDueSentAt: null },
      now,
      30,
    );
    expect(plan).toEqual({ headsUp: false, dueNow: true });
  });

  it("still sends the due-now text shortly after dueAt (grace window)", () => {
    const now = new Date(dueAt.getTime() + 10 * 60_000);
    const plan = planSmsSendsForItem(
      { dueAt, status: "open", smsHeadsUpSentAt: null, smsDueSentAt: null },
      now,
      30,
    );
    expect(plan.dueNow).toBe(true);
  });

  it("does not send a stale due-now text well past the grace window", () => {
    const now = new Date(dueAt.getTime() + 6 * 60 * 60_000); // 6h overdue
    const plan = planSmsSendsForItem(
      { dueAt, status: "open", smsHeadsUpSentAt: null, smsDueSentAt: null },
      now,
      30,
    );
    expect(plan.dueNow).toBe(false);
  });

  it("does not re-send the due-now text once already sent", () => {
    const now = new Date(dueAt.getTime() + 5 * 60_000);
    const plan = planSmsSendsForItem(
      { dueAt, status: "open", smsHeadsUpSentAt: null, smsDueSentAt: new Date() },
      now,
      30,
    );
    expect(plan.dueNow).toBe(false);
  });

  it("sends nothing for snoozed, dismissed, or completed items", () => {
    for (const status of ["snoozed", "dismissed", "completed"]) {
      const plan = planSmsSendsForItem(
        { dueAt, status, smsHeadsUpSentAt: null, smsDueSentAt: null },
        dueAt,
        30,
      );
      expect(plan).toEqual({ headsUp: false, dueNow: false });
    }
  });
});
