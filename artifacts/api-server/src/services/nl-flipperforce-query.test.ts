import { describe, expect, it } from "vitest";
import { isFlipperForceAskIntent, planFlipperForceAsk } from "./nl-flipperforce-query";

describe("nl-flipperforce-query", () => {
  it("matches FlipperForce and rehab questions", () => {
    expect(isFlipperForceAskIntent("What is going on in FlipperForce?")).toBe(true);
    expect(isFlipperForceAskIntent("Show my rehab projects")).toBe(true);
    expect(isFlipperForceAskIntent("How much have we spent on 779 Northwest 41st Street?")).toBe(
      true,
    );
  });

  it("does not steal household finance questions", () => {
    expect(isFlipperForceAskIntent("How much did I spend yesterday?")).toBe(false);
    expect(isFlipperForceAskIntent("What did I spend at Publix?")).toBe(false);
  });

  it("plans reports vs inventory vs activity", () => {
    expect(planFlipperForceAsk("FlipperForce P&L for 779 Northwest 41st Street")?.intent).toBe(
      "report",
    );
    expect(planFlipperForceAsk("List my FlipperForce projects")?.intent).toBe("inventory");
    expect(planFlipperForceAsk("What is going on in FlipperForce?")?.intent).toBe("activity");
  });
});
