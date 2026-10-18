const mocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  retrieve: vi.fn(),
  completion: vi.fn(),
  ensureThread: vi.fn(),
  recentTurns: vi.fn(),
  appendMessage: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("./items", () => ({
  getItemForUser: mocks.getItem,
}));

vi.mock("./retrieval", () => ({
  retrieveRelevantRecords: mocks.retrieve,
}));

vi.mock("./openai-client", () => ({
  createOpenAiClient: () => ({
    chat: { completions: { create: mocks.completion } },
  }),
}));

vi.mock("./ask-threads", () => ({
  ensureAskThreadForUser: mocks.ensureThread,
  listRecentTurnsForThread: mocks.recentTurns,
  retrievalQueryFromHistory: (question: string) => question,
  appendAskMessage: mocks.appendMessage,
}));

vi.mock("./ai-usage", () => ({
  withAiFeature: (_context: unknown, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("./audit", () => ({
  writeAuditLog: mocks.audit,
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryVoiceNotesForUser, VOICE_NO_MATCH_REPLY } from "./voice-answer";

const NOTE_RECORD = {
  entityType: "source_record",
  entityId: "note-1",
  title: "Dell warranty",
  text: "The Dell warranty runs through March 2027 and covers parts and labor.",
  score: 0.92,
  method: "keyword",
  recordType: "evernote_note",
} as const;

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.ensureThread.mockResolvedValue({ id: "thread-1" });
  mocks.recentTurns.mockResolvedValue([]);
  mocks.appendMessage
    .mockResolvedValueOnce({ id: "user-message" })
    .mockResolvedValueOnce({ id: "assistant-message" });
  mocks.audit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("spoken grounded answers", () => {
  it("uses the exact honest reply without a model call when no note matched", async () => {
    mocks.retrieve.mockResolvedValue({
      records: [],
      usedSemantic: false,
      namedPeople: [],
      tasks: [],
    });

    const result = await queryVoiceNotesForUser("u1", "unknown", null);
    expect(result.answer).toBe(VOICE_NO_MATCH_REPLY);
    expect(result.sources).toEqual([]);
    expect(result.privacy.model).toBeNull();
    expect(mocks.completion).not.toHaveBeenCalled();
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: VOICE_NO_MATCH_REPLY,
      }),
    );
  });

  it("uses fixed gpt-4.1-mini and only attributes validated cited notes", async () => {
    mocks.retrieve.mockResolvedValue({
      records: [
        NOTE_RECORD,
        {
          ...NOTE_RECORD,
          entityId: "note-2",
          title: "Uncited note",
        },
        {
          ...NOTE_RECORD,
          entityType: "finance_transaction",
          entityId: "finance-1",
          title: "Not a note",
        },
      ],
      usedSemantic: false,
      namedPeople: [],
      tasks: [],
    });
    mocks.getItem.mockResolvedValue({
      id: "evernote:note-1",
      title: "Dell warranty",
      notebook: "Home",
      bumpedAt: "2024-03-12T12:00:00.000Z",
      updatedAt: "2024-03-12T12:00:00.000Z",
      createdAt: "2024-03-01T12:00:00.000Z",
    });
    mocks.getItem.mockResolvedValueOnce({
      id: "evernote:note-1",
      title: "Dell warranty",
      notebook: "Home",
      bumpedAt: "2024-03-12T12:00:00.000Z",
      updatedAt: "2024-03-12T12:00:00.000Z",
      createdAt: "2024-03-01T12:00:00.000Z",
    });
    mocks.getItem.mockResolvedValueOnce({
      id: "evernote:note-2",
      title: "Uncited note",
      notebook: "Archive",
      bumpedAt: "2024-01-01T12:00:00.000Z",
      updatedAt: "2024-01-01T12:00:00.000Z",
      createdAt: "2024-01-01T12:00:00.000Z",
    });
    mocks.completion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              answer:
                "The warranty runs through March 2027. Coverage includes parts and labor. This fourth sentence is dropped.",
              sourceIds: ["n1", "made-up"],
            }),
          },
        },
      ],
    });

    const voice = await queryVoiceNotesForUser("u1", "warranty?", null);
    expect(mocks.completion).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4.1-mini" }),
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
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: voice.answer,
      }),
    );
  });

  it("does not attribute an answer when every model citation is invalid", async () => {
    mocks.retrieve.mockResolvedValue({
      records: [NOTE_RECORD],
      usedSemantic: false,
      namedPeople: [],
      tasks: [],
    });
    mocks.getItem.mockResolvedValue({
      id: "evernote:note-1",
      title: "Dell warranty",
      notebook: "Home",
      bumpedAt: "2024-03-12T12:00:00.000Z",
      updatedAt: "2024-03-12T12:00:00.000Z",
      createdAt: "2024-03-01T12:00:00.000Z",
    });
    mocks.completion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              answer: "An unsupported claim.",
              sourceIds: ["not-real"],
            }),
          },
        },
      ],
    });

    const voice = await queryVoiceNotesForUser("u1", "warranty?", null);
    expect(voice.answer).toBe(VOICE_NO_MATCH_REPLY);
    expect(voice.sources).toEqual([]);
  });

  it("reports source loading failures instead of claiming no note matched", async () => {
    mocks.retrieve.mockResolvedValue({
      records: [NOTE_RECORD],
      usedSemantic: false,
      namedPeople: [],
      tasks: [],
    });
    mocks.getItem.mockRejectedValue(new Error("db down"));

    await expect(
      queryVoiceNotesForUser("u1", "warranty?", null),
    ).rejects.toThrow("db down");
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });
});
