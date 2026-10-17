import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectResult: [] as Array<{ result: Record<string, unknown> }>,
  claimed: [{ id: "cache-1" }] as Array<{ id: string }>,
  updatedResult: null as Record<string, unknown> | null,
  dashboardDigest: vi.fn(),
  allowBackgroundAi: vi.fn(),
  dailyFeatureUsageForUser: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  isDatabaseConfigured: () => true,
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.selectResult,
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => mocks.claimed,
        }),
      }),
    }),
    update: () => ({
      set: (value: { result: Record<string, unknown> }) => {
        mocks.updatedResult = value.result;
        return { where: async () => undefined };
      },
    }),
  }),
}));

vi.mock("./ai", () => ({
  aiService: { dashboardDigest: mocks.dashboardDigest },
}));

vi.mock("./ai-usage", () => ({
  allowBackgroundAi: mocks.allowBackgroundAi,
  dailyFeatureUsageForUser: mocks.dailyFeatureUsageForUser,
  withAiFeature: (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}));

import { getHomeDashboardDigest } from "./home-dashboard-digest";

const request = {
  userName: "Sam",
  tasks: [{ id: "t1", title: "Call city", completed: false, tags: [] }],
  notes: [],
};
const fallback = {
  digest: "One urgent task.",
  highlights: [],
  degraded: true,
  degradedReason: "disabled_or_capped",
};

beforeEach(() => {
  mocks.selectResult = [];
  mocks.claimed = [{ id: "cache-1" }];
  mocks.updatedResult = null;
  mocks.dashboardDigest.mockReset();
  mocks.allowBackgroundAi.mockReset().mockResolvedValue(true);
  mocks.dailyFeatureUsageForUser.mockReset().mockResolvedValue({
    calls: 0,
    totalTokens: 0,
  });
});

describe("Home dashboard digest guard", () => {
  it("renders the deterministic Home briefing when the kill switch blocks AI", async () => {
    mocks.allowBackgroundAi.mockResolvedValue(false);
    await expect(
      getHomeDashboardDigest("user-1", request, fallback),
    ).resolves.toEqual(fallback);
    expect(mocks.dashboardDigest).not.toHaveBeenCalled();
  });

  it("enforces the per-user daily call cap", async () => {
    mocks.dailyFeatureUsageForUser.mockResolvedValue({
      calls: 3,
      totalTokens: 100,
    });
    await expect(
      getHomeDashboardDigest("user-1", request, fallback),
    ).resolves.toEqual(fallback);
    expect(mocks.dashboardDigest).not.toHaveBeenCalled();
  });

  it("returns a hash-cache hit without making an AI call", async () => {
    const cached = {
      digest: "Cached briefing",
      highlights: ["Cached"],
      degraded: false,
      degradedReason: null,
    };
    mocks.selectResult = [{ result: cached }];
    await expect(
      getHomeDashboardDigest("user-1", request, fallback),
    ).resolves.toEqual(cached);
    expect(mocks.allowBackgroundAi).not.toHaveBeenCalled();
    expect(mocks.dashboardDigest).not.toHaveBeenCalled();
  });

  it("stores the generated result after claiming an input hash once", async () => {
    const generated = {
      digest: "Generated briefing",
      highlights: ["Call city"],
      degraded: false,
      degradedReason: null,
    };
    mocks.dashboardDigest.mockResolvedValue(generated);
    await expect(
      getHomeDashboardDigest("user-1", request, fallback),
    ).resolves.toEqual(generated);
    expect(mocks.dashboardDigest).toHaveBeenCalledTimes(1);
    expect(mocks.updatedResult).toEqual(generated);
  });
});
