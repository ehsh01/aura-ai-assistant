import { describe, expect, it } from "vitest";
import { routeSourcePlan } from "./source-router";
import { DEADLINE_INTENT } from "./query-utils";

describe("deadline intent routing", () => {
  it("routes what's-due questions to a deterministic attention list", () => {
    for (const q of [
      "What deadlines do I have this week?",
      "What's due today?",
      "Any deadlines coming up?",
      "When is the permit inspection?",
      "Show my appointments this week",
    ]) {
      const plan = routeSourcePlan(q);
      expect(plan.answerMode, q).toBe("deterministic_list");
      expect(plan.primary, q).toBe("attention");
      expect(plan.required, q).toContain("attention");
    }
  });

  it("keeps family when-questions on the person path", () => {
    const plan = routeSourcePlan("When is my wife's birthday?");
    expect(plan.primary).not.toBe("attention");
    expect(plan.answerMode).not.toBe("deterministic_list");
  });

  it("keeps waiting-on questions on the waiting path", () => {
    const plan = routeSourcePlan("What am I waiting on from the contractor?");
    expect(plan.primary).toBe("waiting");
  });
});

describe("FlipperForce intent routing", () => {
  it("routes FlipperForce questions away from household finance", () => {
    const plan = routeSourcePlan("What is going on in FlipperForce?");
    expect(plan.primary).toBe("flipperforce");
    expect(plan.required).toContain("flipperforce");
    expect(plan.answerMode).toBe("deterministic_flipperforce");
  });

  it("keeps grocery spend on MyFamilyBudget", () => {
    const plan = routeSourcePlan("how much did I spend yesterday?");
    expect(plan.primary).toBe("finance");
    expect(plan.required).toContain("finance");
  });
});

describe("DEADLINE_INTENT regex", () => {
  it("matches deadline-ish questions", () => {
    expect(DEADLINE_INTENT.test("deadline for the city revision?")).toBe(true);
    expect(DEADLINE_INTENT.test("what's due tomorrow")).toBe(true);
    expect(DEADLINE_INTENT.test("when is the court hearing")).toBe(true);
    expect(DEADLINE_INTENT.test("when is the rent due")).toBe(true);
    expect(DEADLINE_INTENT.test("when is my passport renewal")).toBe(true);
    expect(DEADLINE_INTENT.test("upcoming inspections")).toBe(true);
  });

  it("does not match unrelated when-questions", () => {
    expect(DEADLINE_INTENT.test("when is my wife's birthday")).toBe(false);
    expect(DEADLINE_INTENT.test("when did I buy the Porsche")).toBe(false);
    expect(DEADLINE_INTENT.test("what did Carlos say in his email")).toBe(false);
  });
});
