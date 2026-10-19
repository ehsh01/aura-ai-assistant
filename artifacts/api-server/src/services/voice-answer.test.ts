const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  completion: vi.fn(),
  ensureThread: vi.fn(),
  recentTurns: vi.fn(),
  appendMessage: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("./retrieval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./retrieval")>();
  return {
    ...actual,
    retrieveRelevantRecords: mocks.retrieve,
  };
});

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
import {
  hasAcceptableSubjectLink,
  loadLinkAskFallback,
  type RetrievedRecord,
} from "./retrieval";
import { runHostnameFallbackSafely } from "./notes";

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

const PSYCHIATRY_VYNCS_DECOY = {
  ...NOTE_RECORD,
  entityId: "note-en-23lzct",
  title:
    "Amazon.com: Vyncs No Monthly Fee Connected Car OBD Link, 3G Car GPS Tracker",
  text: "https://www.amazon.com/vyncs-obd-tracker",
  score: 7.7,
} as const;

const PSYCHIATRY_PAP_DECOY = {
  ...NOTE_RECORD,
  entityId: "abnormal-pap-test",
  title: "Abnormal pap test",
  text: "Reference: https://womenshealth.gov/a-z-topics/pap-hpv-tests",
  score: 7.6,
} as const;

const PSYCHIATRY_RECEIPT_DECOY = {
  ...NOTE_RECORD,
  entityId: "build-receipt",
  title: "Your Build.com receipt",
  text: "https://www.build.com/checkout/order?id=123",
  recordType: "gmail_message",
  score: 7.5,
} as const;

const PSYCHIATRY_CLOUD_APP_RECORD = {
  ...NOTE_RECORD,
  entityId: "psychiatry-cloud-app",
  title: "Psychiatry Inventory App",
  text: "https://cloud.digitalocean.com/spaces/psychiatry-inventory?i=abc",
  score: 7.2,
} as const;

const PSYCHIATRY_CASE_RECORDS = [
  PSYCHIATRY_HOW_TO_RECORD,
  PSYCHIATRY_BEST_BUY_EMAIL,
  PSYCHIATRY_BUSINESS_CARD_RECORD,
  PSYCHIATRY_VYNCS_DECOY,
  PSYCHIATRY_PAP_DECOY,
  PSYCHIATRY_RECEIPT_DECOY,
  PSYCHIATRY_REAL_LINK_RECORD,
  PSYCHIATRY_CLOUD_APP_RECORD,
] as const;

const UM_MARKETPLACE_RECORDS = [
  {
    ...NOTE_RECORD,
    entityId: "note-en-3mujtl",
    title: "UM Marketplace link",
    text: "https://nam10.safelinks.protection.outlook.com/?url=https%3A%2F%2Fsecure.touchnet.net%2Fcentral&data=abc",
    score: 9,
  },
  {
    ...NOTE_RECORD,
    entityId: "note-en-shcskr",
    title: "My 981 lowered on HR",
    text: "https://rennlist.com/forums/parts-marketplace/906069-techart-intake-gill-slats-for-981-cayman-s.html",
    score: 8,
  },
] as const;

const HALOGEN_RECORD = {
  ...NOTE_RECORD,
  entityId: "note-en-vmfbij",
  title: "Halogen Portals",
  text: "From: Riveron, Christopher [mailto:c.riveron@med.miami.edu]. Portal: eappraisal.miami.edu",
  score: 9,
} as const;

const KHAILA_RECORD = {
  ...NOTE_RECORD,
  entityId: "khaila-school-portal",
  title: "Khaila school portal",
  text: "Khaila's school access: https://www.dadeschools.net/",
  score: 9,
} as const;

const PSYCHIATRY_INVENTORY_RECORD = {
  ...NOTE_RECORD,
  entityId: "psychiatry-inventory-app",
  title: "Psychiatry Inventory App",
  text: "The note describes the inventory app workflow and access details.",
  score: 9,
} as const;

const KENNY_RECORDS = [
  {
    ...NOTE_RECORD,
    entityId: "build-receipt-kenny",
    title: "Your Build.com receipt",
    text: "Checkout: https://www.build.com/checkout/order?id=456",
    recordType: "gmail_message",
    score: 9,
  },
  {
    ...NOTE_RECORD,
    entityId: "kenny-company",
    title: "Kenny&apos;s company and website",
    text: "http://smartersoftware.io/",
    score: 8,
  },
] as const;

const PSYCHIATRY_SECRET_RECORD = {
  ...NOTE_RECORD,
  entityId: "psychiatry-secret",
  title: "Psychiatry Inventory App",
  text: `SSH host: inventory.example.health
SSH user: psychiatry-admin
SSH password: FakePsychiatryPassword!42
Spaces access key: DO00FAKEACCESSKEY123
Spaces Key: QWxhZGRpbjpPcGVuU2VzYW1lMTIzNDU2Nzg5MDEAB12
Spaces secret key: FAKESECRETKEY1234567890123456789012345678
ssh root@1.2.3.4
Abc123xyzAbc123xyz@Q@Wordtail9
deploy user:Abc123xyzAbc123xyz@Q@Wordtail9/var/www/x`,
  score: 10,
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

async function answerWithFastPathMode(input: {
  enabled: boolean;
  question: string;
  searchRecords: readonly RetrievedRecord[];
  fullRecords: readonly RetrievedRecord[];
}): Promise<{ answer: string; fellThrough: boolean }> {
  vi.stubEnv(
    "RECALL_LINK_ASK_FAST_PATH_ENABLED",
    input.enabled ? "true" : "false",
  );
  const loadFullPath = vi.fn(async () => [...input.fullRecords]);
  const fullPath = await loadLinkAskFallback(
    input.question,
    [...input.searchRecords],
    loadFullPath,
  );
  mocks.retrieve.mockResolvedValue({
    records: fullPath ?? [...input.searchRecords],
    usedSemantic: false,
    namedPeople: [],
    tasks: [],
  });
  mocks.appendMessage.mockResolvedValue({ id: "message" });
  const result = await queryVoiceNotesForUser(
    "u1",
    input.question,
    null,
  );
  return {
    answer: result.answer,
    fellThrough: loadFullPath.mock.calls.length > 0,
  };
}

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

  it.each([
    "what is the Psychiatry website link?",
    "[AppSmith test] what is the Psychiatry website link?",
  ])(
    "selects the Psychiatry hostname over decoys for %s",
    async (question) => {
      mocks.retrieve.mockResolvedValue({
        records: PSYCHIATRY_CASE_RECORDS,
        usedSemantic: false,
        namedPeople: [],
        tasks: [],
      });
      const result = await queryVoiceNotesForUser("u1", question, null);
      expect(result.answer).toContain("https://psychiatry.med.miami.edu");
      expect(result.answer).not.toContain("the-actual-link-here");
      expect(result.answer).not.toContain("policyemail");
      expect(result.answer).not.toContain("maps.google.com");
      expect(result.answer).not.toContain("cloud.digitalocean.com");
      expect(result.answer).toContain(
        "Adding and editing a web link on the Psychiatry website",
      );
      expect(result.sources.map((source) => source.title)).toEqual([
        "Turn an image into a link",
        "Adding and editing a web link on the Psychiatry website",
      ]);
      expect(mocks.completion).not.toHaveBeenCalled();
    },
  );

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

  it("keeps the #1 UM Marketplace note ahead of a forums substring match", async () => {
    mocks.retrieve.mockResolvedValue({
      records: UM_MARKETPLACE_RECORDS,
      usedSemantic: false,
      namedPeople: [],
      tasks: [],
    });

    const result = await queryVoiceNotesForUser(
      "u1",
      "what is the UM Marketplace link",
      null,
    );

    expect(result.answer).toContain("https://secure.touchnet.net/central");
    expect(result.answer).not.toContain("rennlist.com");
    expect(result.sources[0]?.title).toBe("UM Marketplace link");
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it("does not mistake the Halogen sender email for a bare domain", async () => {
    mocks.retrieve.mockResolvedValue({
      records: [HALOGEN_RECORD],
      usedSemantic: false,
      namedPeople: [],
      tasks: [],
    });

    const result = await queryVoiceNotesForUser(
      "u1",
      "what is the Halogen portal link",
      null,
    );

    expect(result.answer).toContain("https://eappraisal.miami.edu");
    expect(result.answer).not.toContain("https://c.riveron");
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it("prefers Kenny's company note over a checkout receipt", async () => {
    mocks.retrieve.mockResolvedValue({
      records: KENNY_RECORDS,
      usedSemantic: false,
      namedPeople: [],
      tasks: [],
    });

    const result = await queryVoiceNotesForUser(
      "u1",
      "what is Kenny's company website link",
      null,
    );

    expect(result.answer).toContain("http://smartersoftware.io/");
    expect(result.answer).not.toContain("build.com");
    expect(result.sources[0]?.title).toBe(
      "Kenny&apos;s company and website",
    );
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it("answers the Khaila school portal from a subject-matching bare domain", async () => {
    mocks.retrieve.mockResolvedValue({
      records: [
        KHAILA_RECORD,
        PSYCHIATRY_BEST_BUY_EMAIL,
        PSYCHIATRY_RECEIPT_DECOY,
      ],
      usedSemantic: false,
      namedPeople: [],
      tasks: [],
    });

    const result = await queryVoiceNotesForUser(
      "u1",
      "what is the khaila school portal link",
      null,
    );

    expect(result.answer).toContain("https://www.dadeschools.net/");
    expect(result.sources[0]?.title).toBe("Khaila school portal");
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "Psychiatry website",
      question: "what is the Psychiatry website link?",
      records: PSYCHIATRY_CASE_RECORDS,
      expected: "https://psychiatry.med.miami.edu",
    },
    {
      name: "Psychiatry website with AppSmith tag",
      question: "[AppSmith test] what is the Psychiatry website link?",
      records: PSYCHIATRY_CASE_RECORDS,
      expected: "https://psychiatry.med.miami.edu",
    },
    {
      name: "Psychiatry short link ask",
      question: "What's my Psychiatry link?",
      records: PSYCHIATRY_CASE_RECORDS,
      expected: "https://psychiatry.med.miami.edu",
    },
    {
      name: "UM Marketplace",
      question: "what is the UM Marketplace link",
      records: UM_MARKETPLACE_RECORDS,
      expected: "https://secure.touchnet.net/central",
    },
    {
      name: "Halogen",
      question: "what is the Halogen portal link",
      records: [HALOGEN_RECORD],
      expected: "https://eappraisal.miami.edu",
    },
    {
      name: "Kenny",
      question: "what is Kenny's company website link",
      records: KENNY_RECORDS,
      expected: "http://smartersoftware.io/",
    },
    {
      name: "Khaila",
      question: "what is the khaila school portal link",
      records: [KHAILA_RECORD, PSYCHIATRY_RECEIPT_DECOY],
      expected: "https://www.dadeschools.net/",
    },
  ])(
    "returns an identical $name answer with the fast path on and off",
    async ({ question, records, expected }) => {
      const on = await answerWithFastPathMode({
        enabled: true,
        question,
        searchRecords: records,
        fullRecords: records,
      });
      const off = await answerWithFastPathMode({
        enabled: false,
        question,
        searchRecords: records,
        fullRecords: records,
      });

      expect(on.answer).toBe(off.answer);
      expect(on.answer).toContain(expected);
      expect(on.fellThrough).toBe(false);
      expect(off.fellThrough).toBe(true);
    },
  );

  it("falls through when Gmail has the only subject-relevant link", async () => {
    const question = "what is the Acme enrollment portal link";
    const irrelevantFtsLink = {
      ...NOTE_RECORD,
      entityId: "unrelated-portal",
      title: "Useful portal directory",
      text: "A different service: https://unrelatedvendor.com/help",
      score: 10,
    } as const;
    const gmailOnlyLink = {
      ...NOTE_RECORD,
      entityId: "acme-email",
      title: "Email about Acme enrollment",
      text: "From: Acme Support <support@acmehealth.com>\nEnrollment portal: https://enroll.acmehealth.com",
      recordType: "gmail_message",
      score: 8,
    } as const;
    expect(
      hasAcceptableSubjectLink(question, irrelevantFtsLink),
    ).toBe(false);

    const on = await answerWithFastPathMode({
      enabled: true,
      question,
      searchRecords: [irrelevantFtsLink],
      fullRecords: [irrelevantFtsLink, gmailOnlyLink],
    });
    const off = await answerWithFastPathMode({
      enabled: false,
      question,
      searchRecords: [irrelevantFtsLink],
      fullRecords: [irrelevantFtsLink, gmailOnlyLink],
    });

    expect(on.fellThrough).toBe(true);
    expect(off.fellThrough).toBe(true);
    expect(on.answer).toBe(off.answer);
    expect(on.answer).toContain("https://enroll.acmehealth.com");
    expect(on.answer).not.toContain("unrelatedvendor.com");
  });

  it("keeps explicit email-link answers identical on the 150-row path", async () => {
    const question = "what is the link from the email about Acme enrollment";
    const gmailOnlyLink = {
      ...NOTE_RECORD,
      entityId: "acme-email-explicit",
      title: "Email about Acme enrollment",
      text: "From: Acme Support <support@acmehealth.com>\nUse https://enroll.acmehealth.com",
      recordType: "gmail_message",
      score: 8,
    } as const;
    const on = await answerWithFastPathMode({
      enabled: true,
      question,
      searchRecords: [],
      fullRecords: [gmailOnlyLink],
    });
    const off = await answerWithFastPathMode({
      enabled: false,
      question,
      searchRecords: [],
      fullRecords: [gmailOnlyLink],
    });

    expect(on.fellThrough).toBe(true);
    expect(on.answer).toBe(off.answer);
    expect(on.answer).toContain("https://enroll.acmehealth.com");
  });

  it("returns the same honest no-link answer after a wrapped fallback timeout", async () => {
    const question = "what is the Acme enrollment portal link";
    const closest = {
      ...NOTE_RECORD,
      entityId: "acme-no-link",
      title: "Acme enrollment",
      text: "Enrollment instructions without a saved URL.",
      score: 8,
    } as const;
    const wrappedTimeout = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("statement timeout"), { code: "57014" }),
    });
    await expect(
      runHostnameFallbackSafely(
        async () => {
          throw wrappedTimeout;
        },
        [] as RetrievedRecord[],
      ),
    ).resolves.toEqual([]);

    const on = await answerWithFastPathMode({
      enabled: true,
      question,
      searchRecords: [closest],
      fullRecords: [closest],
    });
    const off = await answerWithFastPathMode({
      enabled: false,
      question,
      searchRecords: [closest],
      fullRecords: [closest],
    });

    expect(on.answer).toBe(off.answer);
    expect(on.answer).toContain("I couldn't find a relevant Acme");
    expect(on.answer).not.toMatch(/https?:\/\//);
  });

  it("keeps the inventory answer secret-free with the fast path on and off", async () => {
    const question = "What's in my psychiatry inventory app note";
    mocks.completion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              answer:
                "It describes the inventory app workflow and access details.",
              sourceIds: ["n1"],
            }),
          },
        },
      ],
    });
    const records = [
      PSYCHIATRY_INVENTORY_RECORD,
      PSYCHIATRY_SECRET_RECORD,
    ];
    const on = await answerWithFastPathMode({
      enabled: true,
      question,
      searchRecords: [],
      fullRecords: records,
    });
    const off = await answerWithFastPathMode({
      enabled: false,
      question,
      searchRecords: [],
      fullRecords: records,
    });

    expect(on.answer).toBe(off.answer);
    expect(on.answer).toContain("inventory app workflow");
    expect(on.answer).not.toContain("FakePsychiatryPassword!42");
    expect(on.answer).not.toContain("DO00FAKEACCESSKEY123");
  });

  it("treats the exact multi-word Psychiatry Inventory App title as relevant", async () => {
    mocks.retrieve.mockResolvedValue({
      records: [
        PSYCHIATRY_INVENTORY_RECORD,
        PSYCHIATRY_BEST_BUY_EMAIL,
        PSYCHIATRY_RECEIPT_DECOY,
        NOTE_RECORD,
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
                "It describes the inventory app workflow and access details.",
              sourceIds: ["n1"],
            }),
          },
        },
      ],
    });

    const result = await queryVoiceNotesForUser(
      "u1",
      "What's in my psychiatry inventory app note",
      null,
    );
    const request = mocks.completion.mock.calls[0]![0];

    expect(request.messages[0].content).toContain(
      "exact title match for a named note",
    );
    expect(request.messages[1].content).toContain(
      "Exact title match for the named note: Psychiatry Inventory App",
    );
    expect(result.answer).toContain("inventory app workflow");
    expect(result.sources[0]?.title).toBe("Psychiatry Inventory App");
  });

  it("references the raw note instead of exposing a requested credential", async () => {
    mocks.retrieve.mockResolvedValue({
      records: [PSYCHIATRY_SECRET_RECORD],
      usedSemantic: false,
      namedPeople: [],
      tasks: [],
    });

    const result = await queryVoiceNotesForUser(
      "u1",
      "What is the SSH password in my Psychiatry Inventory App note?",
      null,
    );

    expect(result.answer).toBe(
      "That credential is stored in your note Psychiatry Inventory App. Open the note or say “show me” to view it.",
    );
    expect(JSON.stringify(result)).not.toContain(
      "FakePsychiatryPassword!42",
    );
    expect(result.sources[0]?.itemId).toBe("evernote:psychiatry-secret");
    expect(mocks.completion).not.toHaveBeenCalled();
    expect(mocks.appendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: expect.not.stringContaining("FakePsychiatryPassword!42"),
      }),
    );
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
