const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  completion: vi.fn(),
  ensureThread: vi.fn(),
  recentTurns: vi.fn(),
  appendMessage: vi.fn(),
  audit: vi.fn(),
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
  retrievalQueryFromHistory: (
    question: string,
    history: Array<{ role: string; content: string }>,
  ) => {
    const prior = history
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.content)
      .join("\n");
    return prior ? `${prior}\n${question}` : question;
  },
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
  updatedAt: "2024-03-12T12:00:00.000Z",
  sourceMetadata: { notebookName: "Home" },
} as const;

const PSYCHIATRY_HOW_TO_RECORD = {
  ...NOTE_RECORD,
  entityId: "psychiatry-how-to",
  title: "Adding and editing a web link on the Psychiatry website",
  text: `${"intro ".repeat(34)}http://the-actual-link-here.com`,
  score: 9,
} as const;

const PSYCHIATRY_BEST_BUY_EMAIL = {
  ...NOTE_RECORD,
  entityId: "best-buy-promo",
  title: "Best Buy weekend deals",
  text: "Shop now: https://trk.policyemail.bestbuy.com/click/sale",
  recordType: "gmail_message",
  score: 8.8,
} as const;

const PSYCHIATRY_BUSINESS_CARD_RECORD = {
  ...NOTE_RECORD,
  entityId: "psychiatry-business-card",
  title: "Uhealth Psychiatry - Business Card",
  text: "Location: https://maps.google.com/?q=UHealth+Psychiatry",
  score: 8,
} as const;

const PSYCHIATRY_REAL_LINK_RECORD = {
  ...NOTE_RECORD,
  entityId: "psychiatry-image-link",
  title: "Turn an image into a link",
  text: "Use the department site psychiatry.med.miami.edu when linking the image.",
  score: 7.8,
} as const;

const PSYCHIATRY_CASE_RECORDS = [
  PSYCHIATRY_HOW_TO_RECORD,
  PSYCHIATRY_BEST_BUY_EMAIL,
  PSYCHIATRY_BUSINESS_CARD_RECORD,
  PSYCHIATRY_REAL_LINK_RECORD,
] as const;

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
    expect(mocks.retrieve).toHaveBeenCalledWith(
      "u1",
      "warranty?",
      8,
      expect.objectContaining({
        noteSearchQuery: "warranty?",
        semantic: false,
        sourceScope: "all",
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

  it("skips placeholder, tracking, and map links for the real Psychiatry bare domain", async () => {
    mocks.retrieve.mockResolvedValue({
      records: PSYCHIATRY_CASE_RECORDS,
      usedSemantic: false,
      namedPeople: [],
      tasks: [],
    });
    const result = await queryVoiceNotesForUser(
      "u1",
      "[AppSmith test] what is the Psychiatry website link?",
      null,
    );
    expect(result.answer).toContain("https://psychiatry.med.miami.edu");
    expect(result.answer).not.toContain("the-actual-link-here");
    expect(result.answer).not.toContain("policyemail");
    expect(result.answer).not.toContain("maps.google.com");
    expect(result.answer).toContain(
      "Adding and editing a web link on the Psychiatry website",
    );
    expect(result.sources.map((source) => source.title)).toEqual([
      "Turn an image into a link",
      "Adding and editing a web link on the Psychiatry website",
    ]);
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it.each(["AI off", "daily cap exhausted"])(
    "returns the deterministic Psychiatry link with 0 LLM calls when %s",
    async () => {
      mocks.retrieve.mockResolvedValue({
        records: PSYCHIATRY_CASE_RECORDS,
        usedSemantic: false,
        namedPeople: [],
        tasks: [],
      });

      const result = await queryVoiceNotesForUser(
        "u1",
        "What's my Psychiatry website link?",
        null,
        { allowModel: false },
      );

      expect(result?.answer).toBe(
        "Your Psychiatry website link is https://psychiatry.med.miami.edu, from your note Turn an image into a link. The note Adding and editing a web link on the Psychiatry website has related how-to instructions.",
      );
      expect(result?.answer).not.toContain("the-actual-link-here");
      expect(result?.sources.map((source) => source.title)).toEqual([
        "Turn an image into a link",
        "Adding and editing a web link on the Psychiatry website",
      ]);
      expect(result?.privacy.model).toBeNull();
      expect(mocks.completion).not.toHaveBeenCalled();
    },
  );

  it("does not call OpenAI for a link ask even when model access is available", async () => {
    mocks.retrieve.mockResolvedValue({
      records: PSYCHIATRY_CASE_RECORDS,
      usedSemantic: false,
      namedPeople: [],
      tasks: [],
    });
    mocks.completion.mockRejectedValue(new Error("OpenAI unavailable"));

    const result = await queryVoiceNotesForUser(
      "u1",
      "What's my Psychiatry link?",
      null,
    );

    expect(result.answer).toContain(
      "Your Psychiatry link is https://psychiatry.med.miami.edu",
    );
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it("names the closest note instead of returning an unrelated URL", async () => {
    mocks.retrieve.mockResolvedValue({
      records: [
        PSYCHIATRY_HOW_TO_RECORD,
        PSYCHIATRY_BEST_BUY_EMAIL,
        PSYCHIATRY_BUSINESS_CARD_RECORD,
      ],
      usedSemantic: false,
      namedPeople: [],
      tasks: [],
    });

    const result = await queryVoiceNotesForUser(
      "u1",
      "What is my Psychiatry website link?",
      null,
    );

    expect(result.answer).toBe(
      "I couldn't find a relevant Psychiatry website link. The closest note is Adding and editing a web link on the Psychiatry website.",
    );
    expect(result.answer).not.toContain("policyemail");
    expect(result.answer).not.toContain("maps.google.com");
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it("does not let prior unrelated turns dilute a current title query", async () => {
    mocks.recentTurns.mockResolvedValue([
      { role: "user", content: "Show my old Gmail receipts" },
      { role: "assistant", content: "I found several receipts." },
    ]);
    mocks.retrieve.mockResolvedValue({
      records: [],
      usedSemantic: false,
      namedPeople: [],
      tasks: [],
    });

    await queryVoiceNotesForUser(
      "u1",
      'What does my note "Adding and editing a web link on the Psychiatry website" say?',
      null,
    );
    expect(mocks.retrieve).toHaveBeenCalledWith(
      "u1",
      'What does my note "Adding and editing a web link on the Psychiatry website" say?',
      8,
      expect.objectContaining({ sourceScope: "all" }),
    );
  });

  it("uses prior user context for a pronoun-only follow-up", async () => {
    const priorQuestion =
      'What does my note "Adding and editing a web link on the Psychiatry website" say?';
    mocks.recentTurns.mockResolvedValue([
      { role: "user", content: priorQuestion },
      { role: "assistant", content: "It explains how to edit that link." },
    ]);
    mocks.retrieve.mockResolvedValue({
      records: [],
      usedSemantic: false,
      namedPeople: [],
      tasks: [],
    });

    await queryVoiceNotesForUser("u1", "What does it say?", null);
    expect(mocks.retrieve).toHaveBeenCalledWith(
      "u1",
      `${priorQuestion}\nWhat does it say?`,
      8,
      expect.objectContaining({
        noteSearchQuery: `${priorQuestion}\nWhat does it say?`,
      }),
    );
  });

  it("runs note retrieval and the user-message write in parallel", async () => {
    const simulatedDbMs = 80;
    const waitForDb = () =>
      new Promise<void>((resolve) => setTimeout(resolve, simulatedDbMs));
    mocks.retrieve.mockImplementation(async () => {
      await waitForDb();
      return {
        records: [],
        usedSemantic: false,
        namedPeople: [],
        tasks: [],
      };
    });
    mocks.appendMessage.mockReset();
    mocks.appendMessage
      .mockImplementationOnce(async () => {
        await waitForDb();
        return { id: "user-message" };
      })
      .mockResolvedValueOnce({ id: "assistant-message" });

    const startedAt = performance.now();
    await queryVoiceNotesForUser("u1", "missing topic", null);
    const elapsedMs = performance.now() - startedAt;
    const sequentialBaselineMs = simulatedDbMs * 2;

    expect(elapsedMs).toBeLessThan(sequentialBaselineMs - 20);
    console.info(
      `[voice-ask-benchmark] sequential_db_baseline_ms=${sequentialBaselineMs} parallel_after_ms=${elapsedMs.toFixed(1)}`,
    );
  });
});
