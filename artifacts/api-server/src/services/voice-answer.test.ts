import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryAnswer } from "./query-engine";

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(),
}));

vi.mock("./items", () => ({
  getItemForUser: mocks.getItem,
}));

import { buildVoiceAnswer, VOICE_NO_MATCH_REPLY } from "./voice-answer";

function result(overrides: Partial<QueryAnswer> = {}): QueryAnswer {
  return {
    answer:
      "The warranty runs through March 2027. Coverage includes parts and labor. Call Dell before arranging a repair.",
    confidence: 0.9,
    caveats: null,
    evidence: [],
    relatedRecords: [],
    images: [],
    suggestedNextAction: null,
    promptVersion: "test",
    degraded: false,
    threadId: "thread-1",
    privacy: {
      model: "gpt-4.1-mini",
      dataLeftDevice: true,
      categoriesSent: ["note"],
    },
    ...overrides,
  };
}

beforeEach(() => {
  mocks.getItem.mockReset();
});

describe("spoken grounded answers", () => {
  it("uses the exact honest reply when no note source matched", async () => {
    await expect(buildVoiceAnswer("u1", result())).resolves.toEqual({
      answer: VOICE_NO_MATCH_REPLY,
      sources: [],
    });
  });

  it("keeps the answer short and ends by naming the source", async () => {
    mocks.getItem.mockResolvedValue({
      id: "evernote:note-1",
      title: "Dell warranty",
      notebook: "Home",
      bumpedAt: "2024-03-12T12:00:00.000Z",
      updatedAt: "2024-03-12T12:00:00.000Z",
      createdAt: "2024-03-01T12:00:00.000Z",
    });

    const voice = await buildVoiceAnswer(
      "u1",
      result({
        relatedRecords: [
          {
            entityType: "source_record",
            entityId: "note-1",
            title: "Dell warranty",
          },
        ],
      }),
    );

    expect(voice.answer).toBe(
      "The warranty runs through March 2027. Coverage includes parts and labor. From your note Dell warranty, March 2024.",
    );
    expect(voice.sources).toEqual([
      expect.objectContaining({
        itemId: "evernote:note-1",
        title: "Dell warranty",
        notebook: "Home",
      }),
    ]);
  });
});
