import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EVERNOTE_MAX_NOTE_CONTENT_CHARS,
  enumerateEvernoteTaxonomy,
  evernoteMcpFetch,
  evernoteRateLimitBackoffMs,
  evernoteMcpAuthorizationCode,
  fetchEvernoteViaMcp,
  mcpOAuthStateFromSettings,
  mcpSettingsFromOAuthState,
  streamEvernoteViaMcp,
  type EvernoteTaxonomyCheckpoint,
} from "./evernote-mcp";
import {
  openConnectorSettings,
  sealConnectorSettings,
} from "../lib/secret-box";

afterEach(() => {
  delete process.env.SECRETS_ENCRYPTION_KEY;
  delete process.env.EVERNOTE_MCP_PACE_MS;
  delete process.env.EVERNOTE_MCP_MAX_429_RETRIES;
  delete process.env.EVERNOTE_MCP_BACKFILL_CHUNK_SIZE;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Evernote MCP auth persistence", () => {
  it("keeps DCR and OAuth secrets in sealable top-level fields", () => {
    process.env.SECRETS_ENCRYPTION_KEY = "a".repeat(64);
    const settings = mcpSettingsFromOAuthState({
      oauthState: "signed-state",
      clientInformation: {
        client_id: "dcr-client",
        client_secret: "dcr-secret",
      },
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      codeVerifier: "pkce-secret",
      tokenMetadata: { token_type: "Bearer", scope: "notes:read" },
    });
    expect(
      (settings.mcpClientInformation as Record<string, unknown>)?.client_secret,
    ).toBeUndefined();

    const sealed = sealConnectorSettings(settings);
    expect(String(sealed.accessToken)).toMatch(/^v1\./);
    expect(String(sealed.refreshToken)).toMatch(/^v1\./);
    expect(String(sealed.clientSecret)).toMatch(/^v1\./);
    expect(String(sealed.token)).toMatch(/^v1\./);

    const restored = mcpOAuthStateFromSettings(
      openConnectorSettings(sealed),
    );
    expect(restored.clientInformation).toEqual(
      expect.objectContaining({
        client_id: "dcr-client",
        client_secret: "dcr-secret",
      }),
    );
    expect(restored.accessToken).toBe("access-secret");
    expect(restored.refreshToken).toBe("refresh-secret");
    expect(restored.codeVerifier).toBe("pkce-secret");
  });

  it("preserves OAuth plan rejection details for Connect UX", () => {
    expect(() =>
      evernoteMcpAuthorizationCode(
        new URLSearchParams({
          error: "access_denied",
          error_description:
            "This account is not eligible without a paid plan",
        }),
      ),
    ).toThrow("not eligible without a paid plan");
  });
});

describe("Evernote MCP HTTP pacing", () => {
  it("uses exponential jitter while honoring longer Retry-After values", () => {
    expect(evernoteRateLimitBackoffMs(0, null, 0.5)).toBe(1_125);
    expect(evernoteRateLimitBackoffMs(2, 12_000, 0)).toBe(12_000);
    expect(evernoteRateLimitBackoffMs(10, 90_000, 1)).toBe(105_000);
  });

  it("retries HTTP 429 using Retry-After before the SDK consumes headers", async () => {
    vi.stubGlobal("setTimeout", (callback: () => void) => {
      callback();
      return 0;
    });
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? new Response("limited", {
              status: 429,
              headers: { "Retry-After": "0" },
            })
          : new Response("ok", { status: 200 });
      }),
    );
    const response = await evernoteMcpFetch("https://mcp.evernote.com/mcp");
    expect(response.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("marks exhausted HTTP retries so tool retries cannot multiply them", async () => {
    process.env.EVERNOTE_MCP_MAX_429_RETRIES = "2";
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal("setTimeout", (callback: () => void) => {
      callback();
      return 0;
    });
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response("limited", {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }),
    );
    await expect(
      evernoteMcpFetch("https://mcp.evernote.com/mcp"),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 429,
        mcpRetriesExhausted: true,
        retryAfterMs: 4_000,
        evernoteRateLimited: true,
      }),
    );
    expect(calls).toBe(3);
  });
});

describe("Evernote MCP read sync", () => {
  it("lists locally, fetches only changed note bodies, and normalizes GUID evidence", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        calls.push(input);
        if (input.name === "search_notebooks") {
          return {
            structuredContent: {
              notebooks: [{ id: "nb-1", name: "Projects" }],
            },
          };
        }
        if (input.name === "search_tags") {
          return {
            structuredContent: {
              tags: [{ id: "tag-1", name: "permit" }],
            },
          };
        }
        if (input.name === "search_spaces") {
          return { structuredContent: { spaces: [] } };
        }
        if (input.name === "search_notes") {
          return {
            structuredContent: {
              totalResultCount: 2,
              notes: [
                {
                  id: "11111111-1111-4111-8111-111111111111",
                  updatedAt: "2026-09-15T12:00:00Z",
                },
                {
                  id: "22222222-2222-4222-8222-222222222222",
                  updatedAt: "2026-09-16T12:00:00Z",
                },
              ],
            },
          };
        }
        if (input.name === "get_note") {
          return {
            structuredContent: {
              id: input.arguments?.noteId,
              title: "Changed permit note",
              content: "<en-note>Inspector approved the permit</en-note>",
              notebookId: "nb-1",
              tags: [{ id: "tag-1", name: "permit" }],
              updatedAt: "2026-09-16T12:00:00Z",
              version: 9,
              resources: [{ id: "resource-1" }],
            },
          };
        }
        throw new Error(`Unexpected tool ${input.name}`);
      },
    };

    const result = await fetchEvernoteViaMcp(
      client,
      new Map([
        [
          "11111111-1111-4111-8111-111111111111",
          {
            updateSequenceNum: 8,
            contentHash: "same",
            evernoteUpdated: "2026-09-15T12:00:00.000Z",
          },
        ],
      ]),
    );

    expect(result.recordsFetched).toBe(2);
    expect(result.recordsSkipped).toBe(1);
    expect(result.recordsFailed).toBe(0);
    expect(calls.filter((call) => call.name === "get_note")).toHaveLength(1);
    expect(calls.every((call) => call.name.startsWith("search_") || call.name === "get_note")).toBe(true);
    expect(result.records[0]).toMatchObject({
      externalId: "22222222-2222-4222-8222-222222222222",
      recordType: "evernote_note",
      recordTitle: "Changed permit note",
      metadata: {
        notebookGuid: "nb-1",
        notebookName: "Projects",
        tagGuids: ["tag-1"],
        tagNames: ["permit"],
        usn: 9,
        hasAttachments: true,
      },
    });
    expect(result.records[0]?.sourceUrl).toContain(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("does not reconcile deletions when search_notes omits an explicit total", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        if (input.name === "search_notebooks") {
          return { structuredContent: { notebooks: [] } };
        }
        if (input.name === "search_tags") {
          return { structuredContent: { tags: [] } };
        }
        if (input.name === "search_spaces") {
          return { structuredContent: { spaces: [] } };
        }
        if (input.name === "search_notes") {
          return {
            structuredContent: {
              notes: [
                {
                  id: "11111111-1111-4111-8111-111111111111",
                  updatedAt: "2026-09-16T12:00:00Z",
                },
              ],
            },
          };
        }
        return {
          structuredContent: {
            id: input.arguments?.noteId,
            title: "Visible note",
            content: "<en-note>Body</en-note>",
            updatedAt: "2026-09-16T12:00:00Z",
          },
        };
      },
    };
    const result = await fetchEvernoteViaMcp(
      client,
      new Map([
        [
          "99999999-9999-4999-8999-999999999999",
          {
            updateSequenceNum: 1,
            contentHash: "existing",
            evernoteUpdated: "2026-09-15T12:00:00.000Z",
          },
        ],
      ]),
    );
    expect(result.deletedExternalIds).toEqual([]);
  });

  it("retries bounded MCP 429 responses", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    let noteSearchCalls = 0;
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal("setTimeout", (callback: () => void) => {
      callback();
      return 0;
    });
    const client = {
      async callTool(input: { name: string }): Promise<unknown> {
        if (input.name === "search_notes") {
          noteSearchCalls += 1;
          if (noteSearchCalls === 1) {
            return {
              isError: true,
              structuredContent: { status: 429, retryAfter: 0 },
              content: [
                {
                  type: "text",
                  text: "Evernote request throttled",
                },
              ],
            };
          }
          return {
            structuredContent: { totalResultCount: 0, notes: [] },
          };
        }
        throw new Error(`Unexpected tool ${input.name}`);
      },
    };
    const result = await fetchEvernoteViaMcp(client, new Map());
    expect(noteSearchCalls).toBe(2);
    expect(result.recordsFetched).toBe(0);
  });

  it("propagates exhausted body rate limits to the durable job retry", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    process.env.EVERNOTE_MCP_MAX_429_RETRIES = "0";
    vi.spyOn(Math, "random").mockReturnValue(0);
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        if (input.name === "search_notebooks") {
          return { structuredContent: { notebooks: [] } };
        }
        if (input.name === "search_tags") {
          return { structuredContent: { tags: [] } };
        }
        if (input.name === "search_spaces") {
          return { structuredContent: { spaces: [] } };
        }
        if (input.name === "search_notes") {
          return {
            structuredContent: {
              totalResultCount: 1,
              notes: [{ id: "limited-note", updatedAt: "2026-10-17T00:00:00Z" }],
            },
          };
        }
        return {
          isError: true,
          structuredContent: { status: 429, retryAfterMs: 12_000 },
          content: [{ type: "text", text: "rate limit" }],
        };
      },
    };

    await expect(
      streamEvernoteViaMcp(client, {
        syncRunId: "limited-run",
        loadKnownNotes: async () => new Map(),
        processBatch: async () => undefined,
      }),
    ).rejects.toEqual(
      expect.objectContaining({ status: 429, retryAfterMs: 12_000 }),
    );
  });

  it("bounds best-effort taxonomy against substring-matching searches", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    const notebooks = Array.from({ length: 1 }, (_, index) => ({
      id: `nb-${index}`,
      name: `Notebook ${index}`,
      stack: index % 2 ? "Personal" : null,
    }));
    const tags = Array.from({ length: 520 }, (_, index) => ({
      id: `tag-${index}`,
      name: `shared tag ${index}`,
      parentId: index > 0 ? "tag-0" : null,
    }));
    let searches = 0;
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        const query = String(input.arguments?.query ?? "").toLowerCase();
        if (input.name === "search_notebooks") {
          searches += 1;
          const matches = notebooks.filter((item) =>
            item.name.toLowerCase().includes(query),
          );
          return {
            structuredContent: {
              totalResultCount: matches.length,
              notebooks: matches.slice(0, 100),
            },
          };
        }
        if (input.name === "search_tags") {
          searches += 1;
          const matches = tags.filter((item) =>
            item.name.toLowerCase().includes(query),
          );
          return {
            structuredContent: {
              totalResultCount: matches.length,
              tags: matches.slice(0, 100),
            },
          };
        }
        if (input.name === "search_spaces") {
          searches += 1;
          return {
            structuredContent: {
              spaces: [{ id: "space-1", name: "Home" }],
            },
          };
        }
        throw new Error(`Unexpected tool ${input.name}`);
      },
    };
    const checkpoints: EvernoteTaxonomyCheckpoint[] = [];
    const taxonomy = await enumerateEvernoteTaxonomy(client, {
      maxSearches: 64,
      onCheckpoint: async (checkpoint) => {
        checkpoints.push(structuredClone(checkpoint));
      },
    });
    expect(searches).toBeLessThanOrEqual(64);
    expect(checkpoints.at(-1)?.stage).toBe("complete");
    expect(taxonomy.notebooks).toHaveLength(1);
    expect(taxonomy.tags.length).toBeGreaterThan(100);
    expect(taxonomy.tags.length).toBeLessThanOrEqual(520);
  });

  it("lists notes immediately and durably caches lazy taxonomy lookups by ID", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    const tags = [
      { id: "tag-519", name: "Shared label 519" },
      ...Array.from({ length: 519 }, (_, index) => ({
        id: `tag-${index}`,
        name: `Shared label ${index}`,
      })),
    ];
    const notebooks = [
      { id: "nb-target", name: "Projects" },
      ...Array.from({ length: 283 }, (_, index) => ({
        id: `nb-${index}`,
        name: `Notebook ${index}`,
      })),
    ];
    const taxonomyQueries: string[] = [];
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        const query = String(input.arguments?.query ?? "").toLowerCase();
        if (input.name === "search_notes") {
          return {
            structuredContent: {
              totalResultCount: 1,
              notes: [{ id: "note-1", updatedAt: "2026-10-17T00:00:00Z" }],
            },
          };
        }
        if (input.name === "get_note") {
          return {
            structuredContent: {
              id: "note-1",
              title: "Mapped note",
              content: "<en-note>Body</en-note>",
              notebookId: "nb-target",
              tagIds: ["tag-519"],
              updatedAt: "2026-10-17T00:00:00Z",
            },
          };
        }
        if (input.name === "search_notebooks") {
          taxonomyQueries.push(`notebook:${query}`);
          const matches = notebooks.filter((item) =>
            item.name.toLowerCase().includes(query),
          );
          return {
            structuredContent: {
              totalResultCount: matches.length,
              notebooks: matches.slice(0, 100),
            },
          };
        }
        if (input.name === "search_tags") {
          taxonomyQueries.push(`tag:${query}`);
          const matches = tags.filter((item) =>
            item.name.toLowerCase().includes(query),
          );
          return {
            structuredContent: {
              totalResultCount: matches.length,
              tags: matches.slice(0, 100),
            },
          };
        }
        throw new Error(`Unexpected tool ${input.name}`);
      },
    };
    const persisted: {
      notebooks: Map<string, (typeof notebooks)[number]>;
      tags: Map<string, (typeof tags)[number]>;
    } = {
      notebooks: new Map(),
      tags: new Map(),
    };
    const records: Array<{ metadata: Record<string, unknown> }> = [];
    const taxonomy = () => ({
      notebooks: [...persisted.notebooks.values()].map((entity) => ({
        ...entity,
        parentId: null,
        stack: null,
        spaceId: null,
        access: null,
        metadata: {},
      })),
      tags: [...persisted.tags.values()].map((entity) => ({
        ...entity,
        parentId: null,
        stack: null,
        spaceId: null,
        access: null,
        metadata: {},
      })),
      spaces: [],
    });
    const run = async (syncRunId: string) =>
      streamEvernoteViaMcp(client, {
        syncRunId,
        taxonomy: taxonomy(),
        loadKnownNotes: async () => new Map(),
        onTaxonomyEntities: async (resolved) => {
          for (const entity of resolved.notebooks) {
            persisted.notebooks.set(entity.id, entity);
          }
          for (const entity of resolved.tags) {
            persisted.tags.set(entity.id, entity);
          }
        },
        processBatch: async (batch) => {
          records.push(
            ...batch.records.map((record) => ({
              metadata: record.metadata,
            })),
          );
        },
      });

    const first = await run("lazy-1");
    const second = await run("lazy-2");

    expect(taxonomyQueries).toEqual(["notebook:", "tag:"]);
    expect(first.taxonomyLookups).toEqual({ cached: 0, fetched: 2 });
    expect(second.taxonomyLookups).toEqual({ cached: 2, fetched: 0 });
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.metadata).toMatchObject({
        notebookName: "Projects",
        tagNames: ["Shared label 519"],
      });
    }
  });

  it("persists each successful lazy lookup before a later rate-limit deferral", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    process.env.EVERNOTE_MCP_MAX_429_RETRIES = "0";
    vi.spyOn(Math, "random").mockReturnValue(0);
    const persistedIds: string[] = [];
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        if (input.name === "search_notes") {
          return {
            structuredContent: {
              totalResultCount: 1,
              notes: [{ id: "note-limited", updatedAt: "2026-10-17T00:00:00Z" }],
            },
          };
        }
        if (input.name === "get_note") {
          return {
            structuredContent: {
              id: "note-limited",
              notebookId: "nb-resolved",
              tagIds: ["tag-limited"],
              content: "<en-note>Body</en-note>",
            },
          };
        }
        if (input.name === "search_notebooks") {
          return {
            structuredContent: {
              notebooks: [{ id: "nb-resolved", name: "Resolved notebook" }],
            },
          };
        }
        if (input.name === "search_tags") {
          return {
            isError: true,
            structuredContent: { status: 429, retryAfterMs: 12_000 },
            content: [{ type: "text", text: "rate limit" }],
          };
        }
        throw new Error(`Unexpected tool ${input.name}`);
      },
    };

    await expect(
      streamEvernoteViaMcp(client, {
        syncRunId: "lazy-limited",
        taxonomy: { notebooks: [], tags: [], spaces: [] },
        loadKnownNotes: async () => new Map(),
        onTaxonomyEntities: async (resolved) => {
          persistedIds.push(
            ...resolved.notebooks.map((entity) => entity.id),
            ...resolved.tags.map((entity) => entity.id),
          );
        },
        processBatch: async () => {
          throw new Error("batch should not commit while rate limited");
        },
      }),
    ).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 12_000,
      evernoteRateLimited: true,
    });
    expect(persistedIds).toEqual(["nb-resolved"]);
  });

  it("does not checkpoint a note when a lazy taxonomy lookup fails transiently", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    const processBatch = vi.fn();
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        if (input.name === "search_notes") {
          return {
            structuredContent: {
              totalResultCount: 1,
              notes: [{ id: "note-retry", updatedAt: "2026-10-17T00:00:00Z" }],
            },
          };
        }
        if (input.name === "get_note") {
          return {
            structuredContent: {
              id: "note-retry",
              notebookId: "nb-retry",
              content: "<en-note>Body</en-note>",
            },
          };
        }
        if (input.name === "search_notebooks") {
          throw new Error("temporary MCP outage");
        }
        throw new Error(`Unexpected tool ${input.name}`);
      },
    };

    await expect(
      streamEvernoteViaMcp(client, {
        syncRunId: "lazy-retry",
        taxonomy: { notebooks: [], tags: [], spaces: [] },
        loadKnownNotes: async () => new Map(),
        processBatch,
      }),
    ).rejects.toMatchObject({
      message: "temporary MCP outage",
      evernoteTaxonomyLookupRetryable: true,
    });
    expect(processBatch).not.toHaveBeenCalled();
  });

  it("resumes taxonomy from its durable frontier with identical results and progress", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    const notebooks = [
      ...Array.from({ length: 60 }, (_, index) => ({
        id: `nb-a-${index}`,
        name: `a notebook ${index}`,
      })),
      ...Array.from({ length: 60 }, (_, index) => ({
        id: `nb-z-${index}`,
        name: `z notebook ${index}`,
      })),
    ];
    const tags = [
      ...Array.from({ length: 55 }, (_, index) => ({
        id: `tag-b-${index}`,
        name: `b tag ${index}`,
      })),
      ...Array.from({ length: 70 }, (_, index) => ({
        id: `tag-y-${index}`,
        name: `y tag ${index}`,
      })),
    ];
    const calls: string[] = [];
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        const query = String(input.arguments?.query ?? "").toLowerCase();
        calls.push(`${input.name}:${query}`);
        if (input.name === "search_notebooks") {
          const matches = query
            ? notebooks.filter((item) => item.name.startsWith(query))
            : notebooks;
          return {
            structuredContent: {
              totalResultCount: matches.length,
              notebooks: matches.slice(0, 100),
            },
          };
        }
        if (input.name === "search_tags") {
          const matches = query
            ? tags.filter((item) => item.name.startsWith(query))
            : tags;
          return {
            structuredContent: {
              totalResultCount: matches.length,
              tags: matches.slice(0, 100),
            },
          };
        }
        if (input.name === "search_spaces") {
          return {
            structuredContent: {
              spaces: [{ id: "space-home", name: "Home" }],
            },
          };
        }
        throw new Error(`Unexpected tool ${input.name}`);
      },
    };

    let durableCheckpoint: EvernoteTaxonomyCheckpoint | undefined;
    await expect(
      enumerateEvernoteTaxonomy(client, {
        checkpointEverySearches: 10,
        onCheckpoint: async (checkpoint, progress) => {
          durableCheckpoint = structuredClone(checkpoint);
          expect(progress).toMatchObject({
            searchesDone: 10,
            notebooksFound: 100,
            tagsFound: 0,
          });
          throw new Error("simulated worker interruption");
        },
      }),
    ).rejects.toThrow("simulated worker interruption");
    expect(durableCheckpoint).toBeDefined();

    const resumedProgress: Array<{
      stage: string;
      searchesDone: number;
      prefixesQueued: number;
      notebooksFound: number;
      tagsFound: number;
    }> = [];
    const resumed = await enumerateEvernoteTaxonomy(client, {
      checkpoint: durableCheckpoint,
      checkpointEverySearches: 10,
      onCheckpoint: async (_checkpoint, progress) => {
        resumedProgress.push(progress);
      },
    });
    const baseline = await enumerateEvernoteTaxonomy(client);

    expect(resumed).toEqual(baseline);
    expect(calls.filter((call) => call === "search_notebooks:")).toHaveLength(2);
    expect(resumedProgress.at(-1)).toMatchObject({
      stage: "complete",
      notebooksFound: 120,
      tagsFound: 125,
    });
    expect(
      resumedProgress.every(
        (progress) =>
          progress.searchesDone >= 10 &&
          progress.prefixesQueued >= 0,
      ),
    ).toBe(true);
  });

  it("chunks changed-note backfill and reports deferred work", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    process.env.EVERNOTE_MCP_BACKFILL_CHUNK_SIZE = "2";
    let noteCalls = 0;
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        if (input.name === "search_notebooks") {
          return { structuredContent: { notebooks: [] } };
        }
        if (input.name === "search_tags") {
          return { structuredContent: { tags: [] } };
        }
        if (input.name === "search_spaces") {
          return { structuredContent: { spaces: [] } };
        }
        if (input.name === "search_notes") {
          return {
            structuredContent: {
              totalResultCount: 3,
              notes: ["1", "2", "3"].map((suffix) => ({
                id: `${suffix.repeat(8)}-${suffix.repeat(4)}-4${suffix.repeat(3)}-8${suffix.repeat(3)}-${suffix.repeat(12)}`,
                updatedAt: "2026-09-16T12:00:00Z",
              })),
            },
          };
        }
        noteCalls += 1;
        return {
          structuredContent: {
            id: input.arguments?.noteId,
            title: "Backfill note",
            content: "<en-note>Body</en-note>",
            updatedAt: "2026-09-16T12:00:00Z",
          },
        };
      },
    };
    const result = await fetchEvernoteViaMcp(client, new Map());
    expect(noteCalls).toBe(2);
    expect(result.records).toHaveLength(2);
    expect(result.recordsDeferred).toBe(1);
  });

  it("streams all pages through bounded persistence checkpoints", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    process.env.EVERNOTE_MCP_BACKFILL_CHUNK_SIZE = "10";
    const total = 55;
    let noteCalls = 0;
    const batchSizes: number[] = [];
    const checkpoints: number[] = [];
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        if (input.name === "search_notebooks") {
          return { structuredContent: { notebooks: [] } };
        }
        if (input.name === "search_tags") {
          return { structuredContent: { tags: [] } };
        }
        if (input.name === "search_spaces") {
          return { structuredContent: { spaces: [] } };
        }
        if (input.name === "search_notes") {
          const start = Number(input.arguments?.startIndex ?? 0);
          const max = Number(input.arguments?.maxResults ?? 10);
          return {
            structuredContent: {
              totalResultCount: total,
              notes: Array.from(
                { length: Math.min(max, total - start) },
                (_, offset) => ({
                  id: `note-${start + offset}`,
                  updatedAt: "2026-10-17T00:00:00Z",
                }),
              ),
            },
          };
        }
        noteCalls += 1;
        return {
          structuredContent: {
            id: input.arguments?.noteId,
            title: "Paged note",
            content: "<en-note>Body</en-note>",
            updatedAt: "2026-10-17T00:00:00Z",
          },
        };
      },
    };

    const result = await streamEvernoteViaMcp(client, {
      syncRunId: "sync-large",
      loadKnownNotes: async () => new Map(),
      processBatch: async (batch) => {
        batchSizes.push(batch.records.length);
        checkpoints.push(batch.checkpoint.startIndex);
      },
    });

    expect(noteCalls).toBe(total);
    expect(batchSizes).toEqual(Array.from({ length: 55 }, () => 1));
    expect(checkpoints).toEqual(Array.from({ length: 55 }, (_, index) => index + 1));
    expect(result).toMatchObject({
      recordsFetched: total,
      recordsDeferred: 0,
      listingComplete: true,
      authoritativeListing: true,
      batchesProcessed: 55,
    });
  });

  it("resumes a partially committed page and retains full note content", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    process.env.EVERNOTE_MCP_BACKFILL_CHUNK_SIZE = "2";
    const fetched: string[] = [];
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        if (input.name === "search_notebooks") {
          return { structuredContent: { notebooks: [] } };
        }
        if (input.name === "search_tags") {
          return { structuredContent: { tags: [] } };
        }
        if (input.name === "search_spaces") {
          return { structuredContent: { spaces: [] } };
        }
        if (input.name === "search_notes") {
          return {
            structuredContent: {
              totalResultCount: 2,
              notes: [
                { id: "already-durable", updatedAt: "2026-10-17T00:00:00Z" },
                { id: "needs-fetch", updatedAt: "2026-10-17T00:00:00Z" },
              ],
            },
          };
        }
        const id = String(input.arguments?.noteId);
        fetched.push(id);
        return {
          structuredContent: {
            id,
            title: "Huge note",
            content: `<en-note>${"x".repeat(256 * 1024)}</en-note>`,
            updatedAt: "2026-10-17T00:00:00Z",
            resources: [{ id: "binary-skipped", data: "not copied" }],
          },
        };
      },
    };
    let retainedLength = 0;
    let seen: string[] = [];
    let replayed: string[] = [];
    await streamEvernoteViaMcp(client, {
      syncRunId: "resume-run",
      loadKnownNotes: async () =>
        new Map([
          [
            "already-durable",
            {
              updateSequenceNum: null,
              contentHash: "cached",
              evernoteSeenSyncRunId: "resume-run",
              evernoteSeenAtIndex: 0,
            },
          ],
        ]),
      processBatch: async (batch) => {
        retainedLength = batch.records[0]?.recordText.length ?? 0;
        seen.push(...batch.seen.map((item) => item.externalId));
        replayed.push(...batch.replayExternalIds);
      },
    });

    expect(fetched).toEqual(["already-durable", "needs-fetch"]);
    expect(seen).toEqual(["already-durable", "needs-fetch"]);
    expect(replayed).toEqual(["already-durable"]);
    expect(EVERNOTE_MAX_NOTE_CONTENT_CHARS).toBe(Number.POSITIVE_INFINITY);
    expect(retainedLength).toBeGreaterThanOrEqual(256 * 1024);
  });

  it("yields a worker slice after the configured number of durable batches", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    process.env.EVERNOTE_MCP_BACKFILL_CHUNK_SIZE = "2";
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        if (input.name === "search_notebooks") {
          return { structuredContent: { notebooks: [] } };
        }
        if (input.name === "search_tags") {
          return { structuredContent: { tags: [] } };
        }
        if (input.name === "search_notes") {
          const start = Number(input.arguments?.startIndex ?? 0);
          return {
            structuredContent: {
              totalResultCount: 6,
              notes: Array.from({ length: Math.min(2, 6 - start) }, (_, offset) => ({
                id: `yield-${start + offset}`,
                updatedAt: "2026-10-17T00:00:00Z",
              })),
            },
          };
        }
        return {
          structuredContent: {
            id: input.arguments?.noteId,
            content: "<en-note>Body</en-note>",
            updatedAt: "2026-10-17T00:00:00Z",
          },
        };
      },
    };
    const checkpoints: number[] = [];
    const result = await streamEvernoteViaMcp(client, {
      syncRunId: "yield-run",
      loadKnownNotes: async () => new Map(),
      processBatch: async (batch) => {
        checkpoints.push(batch.checkpoint.startIndex);
      },
      maxBatchesPerInvocation: 2,
    });

    expect(checkpoints).toEqual([1, 2]);
    expect(result).toMatchObject({
      startIndex: 2,
      recordsDeferred: 4,
      listingComplete: false,
      authoritativeListing: false,
    });
  });

  it("finishes reconciliation from a checkpoint committed after the final page", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    const client = {
      async callTool(input: { name: string }): Promise<unknown> {
        if (input.name === "search_notebooks") {
          return { structuredContent: { notebooks: [] } };
        }
        if (input.name === "search_tags") {
          return { structuredContent: { tags: [] } };
        }
        if (input.name === "search_spaces") {
          return { structuredContent: { spaces: [] } };
        }
        throw new Error(`Unexpected listing call ${input.name}`);
      },
    };
    const processBatch = vi.fn();
    const result = await streamEvernoteViaMcp(client, {
      syncRunId: "final-page-run",
      checkpoint: {
        startIndex: 50,
        expectedTotal: 50,
        recordsFetched: 50,
        listingAuthoritative: true,
      },
      loadKnownNotes: async () => new Map(),
      processBatch,
    });

    expect(processBatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      listingComplete: true,
      authoritativeListing: true,
      recordsDeferred: 0,
    });
  });
});
