import { describe, expect, it } from "vitest";
import {
  isHomeyAskIntent,
  matchHomeyName,
  planHomeyAsk,
} from "./nl-homey-query";

describe("nl-homey-query", () => {
  it("detects Homey-related questions", () => {
    expect(isHomeyAskIntent("Is the porch light on?")).toBe(true);
    expect(isHomeyAskIntent("What did I spend last month?")).toBe(false);
  });

  it("plans inventory for how-many questions", () => {
    const plan = planHomeyAsk("how many door sensors do i have");
    expect(plan?.intent).toBe("inventory");
    if (plan?.intent === "inventory") {
      expect(plan.classHint).toBe("door");
    }
  });

  it("plans status reads", () => {
    const plan = planHomeyAsk("Is the garage door open?");
    expect(plan?.intent).toBe("status");
    if (plan?.intent === "status") {
      expect(plan.deviceHint?.toLowerCase()).toMatch(/garage/);
    }
  });

  it("plans when-was-opened questions against alarm_contact", () => {
    const plan = planHomeyAsk("When was the front door opened?");
    expect(plan?.intent).toBe("status");
    if (plan?.intent === "status") {
      expect(plan.capabilityHint).toBe("alarm_contact");
      expect(plan.deviceHint?.toLowerCase()).toMatch(/front door/);
    }
  });

  it("plans control with confirmation flag", () => {
    const plan = planHomeyAsk("Lock the front door");
    expect(plan?.intent).toBe("control");
    if (plan?.intent === "control") {
      expect(plan.risky).toBe(true);
      expect(plan.confirmed).toBe(false);
      expect(plan.capabilityHint).toBe("locked");
      expect(plan.value).toBe(true);
    }

    const confirmed = planHomeyAsk("confirm lock the front door");
    expect(confirmed?.intent).toBe("control");
    if (confirmed?.intent === "control") {
      expect(confirmed.confirmed).toBe(true);
    }
  });

  it("matches device names by token overlap", () => {
    const devices = [
      { id: "1", name: "Front Door Lock" },
      { id: "2", name: "Porch Light" },
    ];
    expect(matchHomeyName("porch lights", devices)?.id).toBe("2");
    expect(matchHomeyName("front door", devices)?.id).toBe("1");
    expect(matchHomeyName("kitchen toaster", devices)).toBeNull();
  });
});
