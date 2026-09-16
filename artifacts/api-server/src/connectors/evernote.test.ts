import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evernoteConnector,
  evernoteContentHash,
  evernoteEnmlToText,
  fetchEvernoteBundle,
  isEvernoteOAuthConfigured,
  type EvernoteNoteStore,
} from "./evernote";

afterEach(() => {
  delete process.env.EVERNOTE_CONSUMER_KEY;
  delete process.env.EVERNOTE_CONSUMER_SECRET;
});

describe("evernote connector", () => {
  it("requires both OAuth consumer credentials", () => {
    process.env.EVERNOTE_CONSUMER_KEY = "key";
    expect(isEvernoteOAuthConfigured()).toBe(false);
    process.env.EVERNOTE_CONSUMER_SECRET = "secret";
    expect(isEvernoteOAuthConfigured()).toBe(true);
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
        tags: ["permit"],
        updateSequenceNum: 12,
      },
    });
    expect(result.records[0]?.recordText).toContain("Call inspector");
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
