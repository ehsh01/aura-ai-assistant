import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  completion: vi.fn(),
}));

vi.mock("./openai-client", () => ({
  createOpenAiClient: mocks.createClient,
}));

import { planDriveSearch } from "./nl-drive-query";
import { planGmailSearch } from "./nl-gmail-query";

const savedKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  mocks.createClient.mockReset().mockReturnValue({
    chat: { completions: { create: mocks.completion } },
  });
  mocks.completion.mockReset();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
});

describe("Gmail/Drive planner usage attribution", () => {
  it("routes both planner clients through shared ai_usage instrumentation", async () => {
    mocks.completion
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '{"query":"from:nancy","personName":"Nancy"}',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: `{"query":"fullText contains 'permit' and trashed = false","fileType":null,"personName":null}`,
            },
          },
        ],
      });

    await expect(
      planGmailSearch("find email from Nancy", "user-1"),
    ).resolves.toMatchObject({
      source: "ai",
    });
    await expect(
      planDriveSearch("find permit document", "user-1"),
    ).resolves.toMatchObject({
      source: "ai",
    });

    expect(mocks.createClient).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        feature: "intent_route",
        userId: "user-1",
      }),
    );
    expect(mocks.createClient).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        feature: "intent_route",
        userId: "user-1",
      }),
    );
  });
});
