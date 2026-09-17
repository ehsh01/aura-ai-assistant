import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evernoteConnector,
  evernoteContentHash,
  evernoteEnmlToText,
  EvernoteRateLimitError,
  fetchEvernoteBundle,
  isEvernoteDeveloperTokenConfigured,
  isEvernoteOAuthConfigured,
  isEvernoteSandboxEnabled,
  withEvernoteRateLimitRetry,
  type EvernoteNoteStore,
} from "./evernote";

afterEach(() => {
  delete process.env.EVERNOTE_CONSUMER_KEY;
  delete process.env.EVERNOTE_CONSUMER_SECRET;
  delete process.env.EVERNOTE_DEVELOPER_TOKEN;
  delete process.env.EVERNOTE_OAUTH_REDIRECT_URI;
  delete process.env.EVERNOTE_SANDBOX;
});

describe("evernote connector", () => {
  it("requires both OAuth consumer credentials", () => {
    process.env.EVERNOTE_CONSUMER_KEY = "key";
    expect(isEvernoteOAuthConfigured()).toBe(false);
    process.env.EVERNOTE_CONSUMER_SECRET = "secret";
    expect(isEvernoteOAuthConfigured()).toBe(true);
  });

  it("defaults OAuth to Evernote production", () => {
    expect(isEvernoteSandboxEnabled()).toBe(false);
    process.env.EVERNOTE_SANDBOX = "true";
    expect(isEvernoteSandboxEnabled()).toBe(true);
  });

  it("recognizes an optional server-side developer token", () => {
    expect(isEvernoteDeveloperTokenConfigured()).toBe(false);
    process.env.EVERNOTE_DEVELOPER_TOKEN = "developer-token";
    expect(isEvernoteDeveloperTokenConfigured()).toBe(true);
  });

  it("converts ENML to plain searchable text without encrypted payloads", () => {
    expect(
      evernoteEnmlToText(
        `<?xml version="1.0"?><en-note>Hello &amp; welcome<br/><en-todo checked="true"/>Done<en-crypt>secret</en-crypt></en-note>`,
      ),
    ).toBe("Hello & welcome\n☑ Done [encrypted content]");
  });

  it("hashes title, text, notebook, sorted tags, and source URL", () => {
    const base = {
      title: "Permit",
      text: "Approved",
      notebookName: "Projects",
      tags: ["Miami", "House"],
      sourceUrl: "https://example.com/permit",
    };
    expect(evernoteContentHash(base)).toBe(
      evernoteContentHash({ ...base, tags: ["House", "Miami"] }),
    );
    expect(evernoteContentHash(base)).not.toBe(
      evernoteContentHash({ ...base, text: "Denied" }),
    );
  });

  it("fetches content only for notes whose update sequence changed", async () => {
    const getNote = vi.fn(async (guid: string) => ({
      guid,
      title: "Changed note",
      content: "<en-note>New permit details<br/>Call inspector</en-note>",
      created: 1_700_000_000_000,
      updated: 1_710_000_000_000,
      updateSequenceNum: 12,
      notebookGuid: "nb-1",
      tagGuids: ["tag-1"],
      attributes: {},
    }));
    const noteStore: EvernoteNoteStore = {
      listNotebooks: async () => [{ guid: "nb-1", name: "Construction" }],
      listTags: async () => [{ guid: "tag-1", name: "permit" }],
      findNotesMetadata: async () => ({
        totalNotes: 2,
        notes: [
          {
            guid: "same-guid",
            title: "Same",
            updateSequenceNum: 4,
          },
          {
            guid: "changed-guid",
            title: "Changed note",
            updateSequenceNum: 12,
            largestResourceMime: "image/jpeg",
            largestResourceSize: 1024,
          },
        ],
      }),
      getNote,
    };

    const result = await fetchEvernoteBundle("token", "https://note-store", {
      noteStore,
      accountId: "42",
      webApiUrlPrefix: "https://www.evernote.com/shard/s1/",
      knownNotes: new Map([
        ["same-guid", { updateSequenceNum: 4, contentHash: "old" }],
        ["changed-guid", { updateSequenceNum: 11, contentHash: "old" }],
        ["deleted-guid", { updateSequenceNum: 3, contentHash: "old" }],
      ]),
    });

    expect(result.recordsFetched).toBe(2);
    expect(result.recordsSkipped).toBe(1);
    expect(result.recordsFailed).toBe(0);
    expect(result.deletedExternalIds).toEqual(["deleted-guid"]);
    expect(getNote).toHaveBeenCalledTimes(1);
    expect(getNote).toHaveBeenCalledWith(
      "changed-guid",
      true,
      false,
      false,
      false,
    );
    expect(result.records[0]).toMatchObject({
      externalId: "changed-guid",
      recordType: "evernote_note",
      sourceUrl:
        "https://www.evernote.com/shard/s1/nl/42/changed-guid",
      metadata: {
        notebookName: "Construction",
        tagNames: ["permit"],
        usn: 12,
        evernoteUpdated: new Date(1_710_000_000_000).toISOString(),
        hasAttachments: true,
      },
    });
    expect(result.records[0]?.recordText).toContain("Call inspector");
  });

  it("retries EDAM rate limits within the bounded wait", async () => {
    let calls = 0;
    const result = await withEvernoteRateLimitRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw { errorCode: 19, rateLimitDuration: 0 };
        }
        return "ok";
      },
      { maxRetries: 1, maxWaitSeconds: 1 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("surfaces exhausted EDAM rate limits with retry details", async () => {
    await expect(
      withEvernoteRateLimitRetry(
        async () => {
          throw { errorCode: 19, rateLimitDuration: 90 };
        },
        { maxRetries: 1, maxWaitSeconds: 30 },
      ),
    ).rejects.toEqual(expect.objectContaining<Partial<EvernoteRateLimitError>>({
      status: 429,
      retryAfterSeconds: 90,
    }));
  });

  it("refreshes note metadata when a notebook is renamed without a note USN change", async () => {
    const getNote = vi.fn(async () => ({
      guid: "note-1",
      title: "Note",
      content: "<en-note>Body</en-note>",
      updateSequenceNum: 7,
      notebookGuid: "nb-1",
      tagGuids: [],
    }));
    const noteStore: EvernoteNoteStore = {
      listNotebooks: async () => [{ guid: "nb-1", name: "New name" }],
      listTags: async () => [],
      findNotesMetadata: async () => ({
        totalNotes: 1,
        notes: [
          {
            guid: "note-1",
            updateSequenceNum: 7,
            notebookGuid: "nb-1",
            tagGuids: [],
          },
        ],
      }),
      getNote,
    };
    const result = await fetchEvernoteBundle("token", "https://note-store", {
      noteStore,
      knownNotes: new Map([
        [
          "note-1",
          {
            updateSequenceNum: 7,
            contentHash: "old",
            notebookGuid: "nb-1",
            notebookName: "Old name",
            tagGuids: [],
            tagNames: [],
          },
        ],
      ]),
    });
    expect(getNote).toHaveBeenCalledTimes(1);
    expect(result.records[0]?.metadata.notebookName).toBe("New name");
  });

  it("fails the sync with 429 when a note fetch exhausts its rate limit", async () => {
    const noteStore: EvernoteNoteStore = {
      listNotebooks: async () => [],
      listTags: async () => [],
      findNotesMetadata: async () => ({
        totalNotes: 1,
        notes: [{ guid: "note-1", updateSequenceNum: 1 }],
      }),
      getNote: async () => {
        throw { errorCode: 19, rateLimitDuration: 90 };
      },
    };
    await expect(
      fetchEvernoteBundle("token", "https://note-store", { noteStore }),
    ).rejects.toEqual(
      expect.objectContaining({ status: 429, retryAfterSeconds: 90 }),
    );
  });

  it("fails the sync when tag names cannot be loaded", async () => {
    const noteStore: EvernoteNoteStore = {
      listNotebooks: async () => [],
      listTags: async () => {
        throw new Error("rate limited");
      },
      findNotesMetadata: async () => ({ totalNotes: 0, notes: [] }),
      getNote: async () => ({}),
    };
    await expect(
      fetchEvernoteBundle("token", "https://note-store", { noteStore }),
    ).rejects.toThrow("rate limited");
  });

  it("normalizes Evernote GUIDs as source-record dedupe keys", async () => {
    const rows = await evernoteConnector.normalize([
      {
        externalId: "note-guid",
        recordType: "evernote_note",
        recordTitle: "Title",
        recordText: "Text",
        sourceUrl: null,
        sourceCreatedAt: "2026-01-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-01-02T00:00:00.000Z",
        metadata: { contentHash: "hash" },
      },
    ]);
    expect(rows[0]).toMatchObject({
      externalId: "note-guid",
      recordType: "evernote_note",
      sourceUpdatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(evernoteConnector.mapEvidence(rows[0]!)[0]?.claimType).toBe(
      "source_excerpt",
    );
  });
});
