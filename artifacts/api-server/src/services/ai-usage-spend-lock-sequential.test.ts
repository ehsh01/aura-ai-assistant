import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => {
  let active = 0;
  let calls = 0;
  let maxActive = 0;
  return {
    reset() {
      active = 0;
      calls = 0;
      maxActive = 0;
    },
    state() {
      return { active, calls, maxActive };
    },
    async query() {
      if (active > 0) {
        throw new Error("overlapping query on one pg client");
      }
      active += 1;
      calls += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return [
          {
            micros: "0",
            calls: "0",
            totalTokens: "0",
            characters: "0",
            seconds: "0",
          },
        ];
      } finally {
        active -= 1;
      }
    },
  };
});

vi.mock("../lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => mockClient.query(),
      }),
    }),
  }),
  withDbAdvisoryLockWait: async (
    _key: string,
    callback: () => Promise<unknown>,
  ) => callback(),
}));

import { voiceAiAllowance, withVoiceAiLock } from "./ai-usage";

const ENV_KEYS = [
  "AI_DAILY_BUDGET_USD",
  "RECALL_AI_MONTHLY_BUDGET_USD",
  "RECALL_VOICE_AI_ENABLED",
  "RECALL_VOICE_ASK_DAILY_LIMIT",
] as const;
const original = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  mockClient.reset();
  process.env.AI_DAILY_BUDGET_USD = "1";
  process.env.RECALL_AI_MONTHLY_BUDGET_USD = "15";
  process.env.RECALL_VOICE_AI_ENABLED = "true";
  process.env.RECALL_VOICE_ASK_DAILY_LIMIT = "100";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("voice spend-lock query scheduling", () => {
  it("never overlaps spend and usage reads on the held pg client", async () => {
    await expect(
      withVoiceAiLock("user-1", () => voiceAiAllowance("voice_ask", "user-1")),
    ).resolves.toEqual({ allowed: true, remaining: 99 });

    expect(mockClient.state()).toEqual({
      active: 0,
      calls: 3,
      maxActive: 1,
    });
  });
});
