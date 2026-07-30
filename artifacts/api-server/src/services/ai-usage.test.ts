import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  getDb: () => ({
    insert: mocks.insert,
    select: mocks.select,
  }),
}));

import {
  allowBackgroundAi,
  costMicrosFor,
  currentAiFeature,
  isBackgroundFeature,
  priceFor,
  recordAiUsage,
  resetBudgetCacheForTests,
  usageTokens,
  withAiFeature,
} from "./ai-usage";

/** Stub the drizzle chain used by spendTodayUsd(). */
function stubSpend(micros: number): void {
  mocks.select.mockReturnValue({
    from: () => ({
      where: () => Promise.resolve([{ micros: String(micros) }]),
    }),
  });
}

const ENV_KEYS = [
  "AI_DAILY_BUDGET_USD",
  "RECALL_BACKGROUND_AI_ENABLED",
  "RECALL_ATTACHMENT_OCR_ENABLED",
  "RECALL_AI_DIGESTS_ENABLED",
  "RECALL_EMAIL_AI_SCAN_ENABLED",
] as const;

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  resetBudgetCacheForTests();
  mocks.insert.mockReset();
  mocks.select.mockReset();
  mocks.insert.mockReturnValue({ values: () => Promise.resolve() });
  stubSpend(0);
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("pricing", () => {
  it("prices a known model from its published rate", () => {
    expect(priceFor("gpt-4.1-mini")).toEqual({ input: 0.4, output: 1.6 });
  });

  it("matches dated model snapshots by prefix", () => {
    expect(priceFor("gpt-4.1-mini-2025-04-14")).toEqual({ input: 0.4, output: 1.6 });
  });

  it("falls back to the most expensive rate for unknown models", () => {
    // A new model must never look free, or it could slip past the budget cap.
    const unknown = priceFor("some-future-model");
    expect(unknown.input).toBeGreaterThan(priceFor("gpt-4.1-mini").input);
  });

  it("is case insensitive", () => {
    expect(priceFor("GPT-4.1-Mini")).toEqual(priceFor("gpt-4.1-mini"));
  });

  it("computes cost in micro-dollars from token counts", () => {
    // 1M input @ $0.40 + 1M output @ $1.60 = $2.00 = 2,000,000 micros.
    expect(costMicrosFor("gpt-4.1-mini", 1_000_000, 1_000_000)).toBe(2_000_000);
  });

  it("treats negative token counts as zero", () => {
    expect(costMicrosFor("gpt-4.1-mini", -5, -5)).toBe(0);
  });

  it("reads token counts off an OpenAI usage block", () => {
    expect(usageTokens({ prompt_tokens: 120, completion_tokens: 30 })).toEqual({
      promptTokens: 120,
      completionTokens: 30,
    });
  });

  it("defaults missing usage to zero rather than throwing", () => {
    expect(usageTokens(undefined)).toEqual({ promptTokens: 0, completionTokens: 0 });
  });
});

describe("recordAiUsage", () => {
  it("stores token counts and computed cost", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    mocks.insert.mockReturnValue({ values });

    await recordAiUsage({
      userId: "u1",
      feature: "attachment_ocr",
      model: "gpt-4.1-mini",
      background: true,
      promptTokens: 1_000_000,
      completionTokens: 0,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "attachment_ocr",
        background: true,
        totalTokens: 1_000_000,
        costMicros: 400_000,
      }),
    );
  });

  it("never throws when the write fails", async () => {
    mocks.insert.mockReturnValue({
      values: () => Promise.reject(new Error("db down")),
    });
    await expect(
      recordAiUsage({ feature: "digest", model: "gpt-4.1-mini" }),
    ).resolves.toBeUndefined();
  });
});

describe("background budget guard", () => {
  it("allows background work when no budget is configured", async () => {
    await expect(allowBackgroundAi("attachment_ocr")).resolves.toBe(true);
  });

  it("allows background work while spend is under the cap", async () => {
    process.env.AI_DAILY_BUDGET_USD = "5";
    stubSpend(2_000_000); // $2.00
    await expect(allowBackgroundAi("attachment_ocr")).resolves.toBe(true);
  });

  it("blocks background work once spend reaches the cap", async () => {
    process.env.AI_DAILY_BUDGET_USD = "5";
    stubSpend(5_000_000); // $5.00
    await expect(allowBackgroundAi("attachment_ocr")).resolves.toBe(false);
  });

  it("never blocks user-facing features on the budget", async () => {
    process.env.AI_DAILY_BUDGET_USD = "1";
    stubSpend(999_000_000);
    // Going silent mid-question is worse than the marginal cost of answering.
    await expect(allowBackgroundAi("ask_query")).resolves.toBe(true);
  });

  it("honours the global background kill switch", async () => {
    process.env.RECALL_BACKGROUND_AI_ENABLED = "false";
    await expect(allowBackgroundAi("digest")).resolves.toBe(false);
    await expect(allowBackgroundAi("deadline_extract")).resolves.toBe(false);
  });

  it("honours the OCR-only kill switch without disabling other work", async () => {
    process.env.RECALL_ATTACHMENT_OCR_ENABLED = "false";
    await expect(allowBackgroundAi("attachment_ocr")).resolves.toBe(false);
    await expect(allowBackgroundAi("digest")).resolves.toBe(true);
  });

  it("honours the email-scan kill switch for both scan types", async () => {
    process.env.RECALL_EMAIL_AI_SCAN_ENABLED = "false";
    await expect(allowBackgroundAi("deadline_extract")).resolves.toBe(false);
    await expect(allowBackgroundAi("waiting_extract")).resolves.toBe(false);
    await expect(allowBackgroundAi("attachment_ocr")).resolves.toBe(true);
  });

  it("caches the spend query so a tight loop cannot hammer the database", async () => {
    process.env.AI_DAILY_BUDGET_USD = "5";
    stubSpend(1_000_000);
    await allowBackgroundAi("attachment_ocr");
    await allowBackgroundAi("attachment_ocr");
    await allowBackgroundAi("attachment_ocr");
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });

  it("fails open when the spend query errors", async () => {
    process.env.AI_DAILY_BUDGET_USD = "5";
    mocks.select.mockReturnValue({
      from: () => ({ where: () => Promise.reject(new Error("db down")) }),
    });
    // A reporting outage must not silently disable the product.
    await expect(allowBackgroundAi("digest")).resolves.toBe(true);
  });
});

describe("feature attribution", () => {
  it("defaults to 'other' outside any tagged scope", () => {
    expect(currentAiFeature().feature).toBe("other");
  });

  it("carries the feature through async boundaries", async () => {
    const seen = await withAiFeature({ feature: "ask_query", userId: "u1" }, async () => {
      await Promise.resolve();
      return currentAiFeature();
    });
    expect(seen).toEqual({ feature: "ask_query", userId: "u1" });
  });

  it("restores the outer scope after the inner one finishes", async () => {
    await withAiFeature({ feature: "digest" }, async () => {
      await withAiFeature({ feature: "attachment_ocr" }, async () => {
        expect(currentAiFeature().feature).toBe("attachment_ocr");
      });
      expect(currentAiFeature().feature).toBe("digest");
    });
    expect(currentAiFeature().feature).toBe("other");
  });

  it("classifies which features count as background spend", () => {
    expect(isBackgroundFeature("attachment_ocr")).toBe(true);
    expect(isBackgroundFeature("ask_query")).toBe(false);
  });
});
