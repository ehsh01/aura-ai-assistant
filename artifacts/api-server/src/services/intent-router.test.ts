import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ClassifyIntentResult } from "../prompts/classifyIntent.v1";

const mocks = vi.hoisted(() => ({
  classifyIntent: vi.fn(),
}));

// Only the Intent Router consumes aiService at runtime here; query-utils uses a
// type-only import and nl-gmail-query does not import ai, so this mock is safe.
vi.mock("./ai", () => ({
  aiService: { classifyIntent: mocks.classifyIntent },
}));

import { regexFastPath, routeIntentForText } from "./intent-router";

function modelResult(overrides: Partial<ClassifyIntentResult> = {}): ClassifyIntentResult {
  return {
    primaryIntent: "question",
    secondaryIntents: [],
    confidence: 0.9,
    requiresConfirmation: false,
    containsQuestion: true,
    containsAction: false,
    containsDurableFact: false,
    containsDeadline: false,
    containsAttachment: false,
    reason: "test",
    ...overrides,
  };
}

describe("regexFastPath — clear questions route without a model call", () => {
  it("classifies a direct 'what do I know' question", () => {
    const r = regexFastPath("What do I know about Nancy?");
    expect(r?.primaryIntent).toBe("question");
    expect(r?.containsQuestion).toBe(true);
  });

  it("classifies a finance question as finance_question", () => {
    const r = regexFastPath("How much did I spend on groceries last month?");
    expect(r?.primaryIntent).toBe("finance_question");
  });

  it("classifies an email search question", () => {
    const r = regexFastPath("did nancy email me last week?");
    expect(r?.primaryIntent).toBe("question");
  });

  it("tags a waiting question with a waiting_on secondary intent", () => {
    const r = regexFastPath("who am I waiting on for the permit?");
    expect(r?.primaryIntent).toBe("question");
    expect(r?.secondaryIntents).toContain("waiting_on");
  });

  it("does not rely on a trailing question mark alone (interrogative shape)", () => {
    const r = regexFastPath("How do I renew my passport");
    expect(r?.primaryIntent).toBe("question");
  });
});

describe("regexFastPath — clear captures route without a model call", () => {
  it("classifies a 'remember that' durable fact as capture", () => {
    const r = regexFastPath("Remember that my passport expires in June 2027");
    expect(r?.primaryIntent).toBe("capture");
    expect(r?.containsDurableFact).toBe(true);
    expect(r?.containsQuestion).toBe(false);
  });

  it("classifies 'remind me' as a reminder capture", () => {
    const r = regexFastPath("Remind me to call the plumber tonight");
    expect(r?.primaryIntent).toBe("reminder");
    expect(r?.containsDeadline).toBe(true);
  });

  it("classifies an explicit task add as an actionable capture", () => {
    const r = regexFastPath("add a task to send the invoice");
    expect(r?.primaryIntent).toBe("capture");
    expect(r?.containsAction).toBe(true);
  });
});

describe("regexFastPath — ambiguous inputs defer to the model", () => {
  it("returns null for a bare statement (finance record without a lead)", () => {
    expect(regexFastPath("spent $40 on gas at Shell")).toBeNull();
  });

  it("returns null for pasted prose with no clear question or capture lead", () => {
    expect(
      regexFastPath("The meeting notes from yesterday about the roofing estimate"),
    ).toBeNull();
  });

  it("returns null for a capture lead phrased as a question (both signals)", () => {
    expect(regexFastPath("remember when we talked about the permit?")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(regexFastPath("   ")).toBeNull();
  });
});

describe("routeIntentForText — regex fast-path short-circuits the model", () => {
  beforeEach(() => mocks.classifyIntent.mockReset());

  it("routes a clear question to the Ask engine without calling the model", async () => {
    const decision = await routeIntentForText("What do I know about Nancy?");
    expect(decision.route).toBe("question");
    expect(decision.source).toBe("regex");
    expect(mocks.classifyIntent).not.toHaveBeenCalled();
  });

  it("routes a clear capture to the inbox without calling the model", async () => {
    const decision = await routeIntentForText("Remember that my car registration is due");
    expect(decision.route).toBe("capture");
    expect(decision.source).toBe("regex");
    expect(mocks.classifyIntent).not.toHaveBeenCalled();
  });
});

describe("routeIntentForText — model fallback and safe defaults", () => {
  beforeEach(() => mocks.classifyIntent.mockReset());

  it("calls the model only for ambiguous input and routes a confident question", async () => {
    mocks.classifyIntent.mockResolvedValue({
      degraded: false,
      degradedReason: null,
      result: modelResult({ primaryIntent: "question", confidence: 0.9 }),
    });
    const decision = await routeIntentForText("the roofing estimate from yesterday");
    expect(mocks.classifyIntent).toHaveBeenCalledTimes(1);
    expect(decision.route).toBe("question");
    expect(decision.source).toBe("model");
  });

  it("routes a confident capture to the inbox", async () => {
    mocks.classifyIntent.mockResolvedValue({
      degraded: false,
      degradedReason: null,
      result: modelResult({
        primaryIntent: "finance_record",
        confidence: 0.85,
        containsQuestion: false,
      }),
    });
    const decision = await routeIntentForText("spent $40 on gas at Shell");
    expect(decision.route).toBe("capture");
  });

  it("safe-defaults a DEGRADED model to the inbox with requiresConfirmation", async () => {
    mocks.classifyIntent.mockResolvedValue({
      degraded: true,
      degradedReason: "intent_classify_failed",
      result: modelResult({ primaryIntent: "unknown", confidence: 0 }),
    });
    const decision = await routeIntentForText("something ambiguous here");
    expect(decision.route).toBe("capture");
    expect(decision.degraded).toBe(true);
    expect(decision.result.requiresConfirmation).toBe(true);
  });

  it("safe-defaults a LOW-confidence result to the inbox even if it looks like a question", async () => {
    mocks.classifyIntent.mockResolvedValue({
      degraded: false,
      degradedReason: null,
      result: modelResult({ primaryIntent: "question", confidence: 0.3 }),
    });
    const decision = await routeIntentForText("the roofing thing");
    expect(decision.route).toBe("capture");
    expect(decision.result.requiresConfirmation).toBe(true);
  });

  it("safe-defaults when the model returns a schema-invalid payload", async () => {
    mocks.classifyIntent.mockResolvedValue({
      degraded: false,
      degradedReason: null,
      result: { primaryIntent: "not-a-real-intent", confidence: 2 } as unknown as ClassifyIntentResult,
    });
    const decision = await routeIntentForText("weird payload");
    expect(decision.route).toBe("capture");
    expect(decision.degraded).toBe(true);
    expect(decision.result.requiresConfirmation).toBe(true);
  });
});
