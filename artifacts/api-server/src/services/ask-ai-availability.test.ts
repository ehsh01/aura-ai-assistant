import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  allowance: vi.fn(),
}));

vi.mock("./ai", () => ({
  aiService: { getStatus: mocks.status },
}));
vi.mock("./ai-usage", () => ({
  userAiAllowance: mocks.allowance,
}));

const { askAiAvailabilityForUser } = await import("./ask-ai-availability");

describe("Ask AI availability", () => {
  afterEach(() => {
    delete process.env.RECALL_ASK_AI_ENABLED;
    vi.clearAllMocks();
  });

  it("disables Ask AI at the kill switch", async () => {
    process.env.RECALL_ASK_AI_ENABLED = "false";
    mocks.status.mockReturnValue({ enabled: true, model: "gpt-4.1-mini" });

    await expect(askAiAvailabilityForUser("user-1")).resolves.toEqual({
      allowed: false,
      model: "gpt-4.1-mini",
      reason: "disabled",
    });
    expect(mocks.allowance).not.toHaveBeenCalled();
  });

  it("disables Ask AI when the daily allowance is exhausted", async () => {
    mocks.status.mockReturnValue({ enabled: true, model: "gpt-4.1-mini" });
    mocks.allowance.mockResolvedValue({
      allowed: false,
      reason: "daily_limit",
    });

    await expect(askAiAvailabilityForUser("user-1")).resolves.toMatchObject({
      allowed: false,
      reason: "daily_limit",
    });
  });
});
