import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EVERNOTE_MAX_NOTE_CONTENT_CHARS,
  EvernoteReadOnlyViolation,
  createEvernoteReadOnlyCaller,
  enumerateEvernoteTaxonomy,
  evernoteMcpFetch,
  evernoteRateLimitBackoffMs,
  evernoteMcpAuthorizationCode,
  fetchEvernoteViaMcp,
  mcpOAuthStateFromSettings,
  mcpSettingsFromOAuthState,
  parseEvernoteNoteListingPage,
  streamEvernoteViaMcp,
  testEvernoteMcpConnection,
  type EvernoteTaxonomyCheckpoint,
} from "./evernote-mcp";
import {
  openConnectorSettings,
  sealConnectorSettings,
} from "../lib/secret-box";
import { connectorTestErrorResponse } from "../routes/connector-test-error";

afterEach(() => {
  delete process.env.SECRETS_ENCRYPTION_KEY;
  delete process.env.EVERNOTE_MCP_PACE_MS;
  delete process.env.EVERNOTE_MCP_MAX_429_RETRIES;
  delete process.env.EVERNOTE_MCP_BACKFILL_CHUNK_SIZE;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const noteListingFixture = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/evernote-search-notes-listing.sanitized.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Record<string, unknown>;

describe("Evernote MCP read-only boundary", () => {
  it("passes every read-only tool-name shape through to the SDK client", async () => {
    const callTool = vi.fn(async (input: { name: string }) => ({
      tool: input.name,
    }));
    const client = createEvernoteReadOnlyCaller({ callTool });
    const allowed = [
      "search_notes",
      "search_future_resource",
      "get_note",
      "get_future_resource",
      "semantic_search",
      "get_attachment",
    ];

    for (const name of allowed) {
      await expect(client.callTool({ name })).resolves.toEqual({ tool: name });
    }
    expect(callTool).toHaveBeenCalledTimes(allowed.length);
  });

  it("blocks write families, unknown names, and an empty name before SDK dispatch", async () => {
    const callTool = vi.fn(async () => ({}));
    const client = createEvernoteReadOnlyCaller({ callTool });
    const rejected = [
      "create_note",
      "edit_note",
      "delete_note",
      "move_notes",
      "rename_notebook",
      "update_note",
      "restore_note",
      "start_attachment_upload",
      "finalize_attachment",
      "list_notebooks",
      "do_something",
      "",
    ];

    for (const name of rejected) {
      await expect(client.callTool({ name })).rejects.toBeInstanceOf(
        EvernoteReadOnlyViolation,
      );
    }
    expect(callTool).not.toHaveBeenCalled();
  });

  it("dispatches the validated tool name instead of the caller's mutable input", async () => {
    const dispatched: string[] = [];
    const client = createEvernoteReadOnlyCaller({
      async callTool(input) {
        dispatched.push(input.name);
        return {};
      },
    });
    let reads = 0;
    const input = {
      get name() {
        reads += 1;
        return reads === 1 ? "search_notes" : "delete_note";
      },
    };

    await client.callTool(input);

    expect(reads).toBe(1);
    expect(dispatched).toEqual(["search_notes"]);
  });

  it("keeps direct SDK callTool dispatch inside the guarded wrapper", () => {
    const srcRoot = fileURLToPath(new URL("../", import.meta.url));
    const sourceFiles: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(path);
        } else if (
          /\.(?:ts|tsx)$/.test(entry.name) &&
          !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)
        ) {
          sourceFiles.push(path);
        }
      }
    };
    visit(srcRoot);

    const mcpPath = join(srcRoot, "connectors", "evernote-mcp.ts");
    const mcpSource = readFileSync(mcpPath, "utf8");
    const wrapperStart = mcpSource.indexOf(
      "export function createEvernoteReadOnlyCaller",
    );
    const wrapperEnd = mcpSource.indexOf(
      "\n}\n\nfunction invokeTool",
      wrapperStart,
    );
    expect(wrapperStart).toBeGreaterThanOrEqual(0);
    expect(wrapperEnd).toBeGreaterThan(wrapperStart);

    const violations = sourceFiles.flatMap((path) => {
      let source = readFileSync(path, "utf8");
      if (path === mcpPath) {
        source =
          source.slice(0, wrapperStart) +
          source.slice(wrapperEnd + "\n}\n".length);
      }
      return source.includes(".callTool(") ? [relative(srcRoot, path)] : [];
    });
    expect(violations).toEqual([]);
    expect(
      mcpSource.slice(wrapperStart, wrapperEnd).match(/\.callTool\(/g),
    ).toHaveLength(1);
  });

  it("keeps the listing dry-run read-only and output metadata-only", () => {
    const source = readFileSync(
      new URL("../evernote-dry-run-list-cli.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\.(?:insert|update|delete)\s*\(/);
    expect(source).toContain("fetchEvernoteNoteListingPage");
    expect(source).toContain("planEvernoteNotebookRanges");
    expect(source).toContain("rowsBeyondFirst2000");
    expect(source).toContain("--notebook-guid");
    expect(source).toContain("startIndex");
    expect(source).not.toContain("onStateChanged");
  });
});

describe("Evernote MCP connection probe", () => {
  const settings = {
    authTransport: "mcp",
    mcpOAuthState: "test-state",
    mcpClientInformation: { client_id: "test-client" },
    accessToken: "test-access-token",
  };

  it("makes exactly one small search_notebooks call", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "10000";
    vi.spyOn(Client.prototype, "connect").mockResolvedValue(undefined);
    const callTool = vi
      .spyOn(Client.prototype, "callTool")
      .mockResolvedValue({
        structuredContent: {
          notebooks: [{ id: "notebook-1", name: "Projects" }],
        },
      } as never);

    const result = await testEvernoteMcpConnection(settings, undefined, {
      timeoutMs: 100,
    });

    expect(result.notebookCount).toBe(1);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith({
      name: "search_notebooks",
      arguments: { query: "", maxResults: 1 },
    });
  });

  it("maps a tool-level invalid_grant response to AUTH_FAILED without retrying", async () => {
    vi.spyOn(Client.prototype, "connect").mockResolvedValue(undefined);
    const callTool = vi
      .spyOn(Client.prototype, "callTool")
      .mockResolvedValue({
        isError: true,
        structuredContent: { status: 401, code: "invalid_grant" },
        content: [{ type: "text", text: "invalid_grant" }],
      } as never);
    let error: unknown;

    try {
      await testEvernoteMcpConnection(settings, undefined, {
        timeoutMs: 100,
      });
    } catch (caught) {
      error = caught;
    }

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(connectorTestErrorResponse(error)).toEqual({
      status: 401,
      body: {
        error: "AUTH_FAILED",
        message: "Evernote didn't respond — reconnect Evernote",
      },
    });
  });

  it("does not retry a tool-level 429 during the connection probe", async () => {
    vi.spyOn(Client.prototype, "connect").mockResolvedValue(undefined);
    const callTool = vi
      .spyOn(Client.prototype, "callTool")
      .mockResolvedValue({
        isError: true,
        structuredContent: { status: 429, retryAfter: 60 },
        content: [{ type: "text", text: "rate limit" }],
      } as never);

    await expect(
      testEvernoteMcpConnection(settings, undefined, {
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("times out a fetch that never resolves and closes the transport", async () => {
    const close = vi.spyOn(StreamableHTTPClientTransport.prototype, "close");
    const fetchFn = vi.fn(() => new Promise<Response>(() => undefined));

    let error: unknown;
    try {
      await testEvernoteMcpConnection(settings, undefined, {
        timeoutMs: 25,
        fetchFn,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      status: 504,
      message: "Evernote didn't respond — reconnect Evernote",
    });
    expect(connectorTestErrorResponse(error)).toMatchObject({
      status: 504,
      body: { error: "UPSTREAM_TIMEOUT" },
    });
    expect(fetchFn).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("turns an HTTP 401 into the reconnect error used by AUTH_FAILED", async () => {
    const fetchFn = vi.fn(async () =>
      new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      }),
    );
    let error: unknown;
    try {
      await testEvernoteMcpConnection(settings, undefined, {
        timeoutMs: 250,
        fetchFn,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      status: 401,
      message: "Evernote didn't respond — reconnect Evernote",
    });
    expect(connectorTestErrorResponse(error)).toEqual({
      status: 401,
      body: {
        error: "AUTH_FAILED",
        message: "Evernote didn't respond — reconnect Evernote",
      },
    });
  });
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

    const restored = mcpOAuthStateFromSettings(openConnectorSettings(sealed));
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
          error_description: "This account is not eligible without a paid plan",
        }),
      ),
    ).toThrow("not eligible without a paid plan");
  });
});

describe("Evernote search_notes page parsing", () => {
  it("parses the sanitized production text listing and footer", () => {
    const page = parseEvernoteNoteListingPage(
      noteListingFixture.textContentForm,
      0,
    );
    expect(page.rows).toEqual([
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        title: "[REDACTED_TITLE_1]",
      }),
      expect.objectContaining({
        id: "22222222-2222-4222-8222-222222222222",
        title: "[REDACTED_TITLE_2]",
      }),
    ]);
    expect(page).toMatchObject({
      totalResultCount: 4927,
      startIndex: 0,
      hasMore: true,
      shape: {
        contentTypes: ["text"],
      },
    });
  });

  it("parses nested structuredContent noteList rows", () => {
    const page = parseEvernoteNoteListingPage(
      noteListingFixture.structuredContentForm,
      2,
    );
    expect(page.rows.map((row) => row.noteGuid)).toEqual([
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ]);
    expect(page).toMatchObject({
      totalResultCount: 4927,
      startIndex: 2,
      hasMore: true,
    });
  });

  it("parses the sanitized empty page at Evernote's 2,000-row cap", () => {
    expect(
      parseEvernoteNoteListingPage(noteListingFixture.emptyAtCapForm, 2_000),
    ).toMatchObject({
      rows: [],
      totalResultCount: 4927,
      startIndex: 2_000,
      hasMore: true,
    });
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

  it("clones Request bodies before each HTTP retry", async () => {
    const bodies: string[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      bodies.push(await (input as Request).text());
      return bodies.length === 1
        ? new Response("limited", {
            status: 429,
            headers: { "Retry-After": "0" },
          })
        : new Response("ok", { status: 200 });
    });
    const request = new Request("https://mcp.evernote.com/mcp", {
      method: "POST",
      body: '{"probe":true}',
    });

    const response = await evernoteMcpFetch(request, undefined, { fetchFn });

    expect(response.status).toBe(200);
    expect(bodies).toEqual(['{"probe":true}', '{"probe":true}']);
  });

  it("retries HTTP 503 and HTML error responses as transient", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal("setTimeout", (callback: () => void) => {
      callback();
      return 0;
    });
    const responses = [
      new Response("backend unavailable", { status: 503 }),
      new Response("<html><body>proxy error</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      new Response("ok", { status: 200 }),
    ];
    const fetchFn = vi.fn(async () => responses.shift()!);

    const response = await evernoteMcpFetch(
      "https://mcp.evernote.com/mcp",
      undefined,
      { fetchFn, maxRetries: 2 },
    );

    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("marks exhausted HTTP 503 responses for attempt-free deferral", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchFn = vi.fn(
      async () => new Response("backend unavailable", { status: 503 }),
    );

    await expect(
      evernoteMcpFetch("https://mcp.evernote.com/mcp", undefined, {
        fetchFn,
        maxRetries: 0,
      }),
    ).rejects.toMatchObject({
      status: 503,
      evernoteTransient: true,
      retryAfterMs: 1_000,
    });
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
  it("migrates a 2,000-row checkpoint, retries the named failure, and never requests the capped offset", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    process.env.EVERNOTE_MCP_BACKFILL_CHUNK_SIZE = "25";
    const total = 2_001;
    const failedIndex = 731;
    const guid = (index: number) =>
      `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
    const known = new Map(
      Array.from({ length: 2_000 }, (_, index) => index)
        .filter((index) => index !== failedIndex)
        .map((index) => [
          guid(index),
          {
            updateSequenceNum: null,
            contentHash: "stored",
            evernoteUpdated: null,
            evernoteSeenSyncRunId: "resume-capped",
            evernoteProcessedSyncRunId: "resume-capped",
          },
        ]),
    );
    const searchCalls: Array<Record<string, unknown>> = [];
    const bodyCalls: string[] = [];
    const textPage = (
      ids: number[],
      startIndex: number,
      resultTotal: number,
    ) => ({
      content: [
        {
          type: "text",
          text: `${ids
            .map(
              (index, offset) =>
                `${offset + 1}. ${guid(index)} — Sanitized note ${index}`,
            )
            .join(
              "\n",
            )}\n\nShowing ${ids.length} of ${resultTotal} (startIndex=${startIndex}${startIndex + ids.length < resultTotal ? ", more available" : ""}).`,
        },
      ],
      structuredContent: { totalResultCount: resultTotal },
    });
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        if (input.name === "search_notebooks") {
          return {
            structuredContent: {
              notebooks: [{ id: "nb-big", name: "Sanitized archive" }],
            },
          };
        }
        if (input.name === "search_notes") {
          const args = input.arguments ?? {};
          searchCalls.push(args);
          const query = String(args.query ?? "");
          const start = Number(args.startIndex ?? 0);
          const max = Number(args.maxResults ?? 25);
          if (!query.includes("nbGuid:")) {
            if (start >= 2_000) {
              return noteListingFixture.emptyAtCapForm;
            }
            const count = Math.min(max, total - start);
            return textPage(
              Array.from({ length: count }, (_, offset) => start + offset),
              start,
              total,
            );
          }
          let rangeStart = 0;
          let rangeTotal = total;
          if (query.includes("-created:")) {
            rangeTotal = 1_000;
          } else if (query.includes("created:")) {
            rangeStart = 1_000;
            rangeTotal = 1_001;
          }
          const count = Math.min(max, rangeTotal - start);
          return textPage(
            Array.from(
              { length: Math.max(0, count) },
              (_, offset) => rangeStart + start + offset,
            ),
            start,
            rangeTotal,
          );
        }
        if (input.name === "get_note") {
          const id = String(input.arguments?.noteId);
          bodyCalls.push(id);
          return {
            structuredContent: {
              id,
              title:
                id === guid(failedIndex)
                  ? "Sanitized failed note"
                  : "Sanitized new note",
              content: "<en-note>Sanitized body</en-note>",
              notebookId: "nb-big",
            },
          };
        }
        throw new Error(`Unexpected tool ${input.name}`);
      },
    };

    const result = await streamEvernoteViaMcp(client, {
      syncRunId: "resume-capped",
      partitionByNotebook: true,
      checkpoint: {
        startIndex: 2_000,
        expectedTotal: 4_927,
        recordsFetched: 2_000,
        recordsSkipped: 0,
        recordsFailed: 1,
        batchesProcessed: 2_000,
        listingAuthoritative: true,
      },
      taxonomy: { notebooks: [], tags: [], spaces: [] },
      loadKnownNotes: async (ids) =>
        new Map(
          ids.filter((id) => known.has(id)).map((id) => [id, known.get(id)!]),
        ),
      processBatch: async (batch) => {
        for (const item of batch.seen) {
          const previous = known.get(item.externalId);
          known.set(item.externalId, {
            updateSequenceNum: null,
            contentHash: previous?.contentHash ?? "stored",
            evernoteUpdated: null,
            evernoteSeenSyncRunId: "resume-capped",
            evernoteProcessedSyncRunId: "resume-capped",
          });
        }
      },
    });

    expect(
      searchCalls.some(
        (call) =>
          String(call.query ?? "").includes("nbGuid:") &&
          Number(call.startIndex) >= 2_000,
      ),
    ).toBe(false);
    expect(bodyCalls).toEqual([guid(failedIndex), guid(2_000)]);
    expect(result).toMatchObject({
      startIndex: total,
      recordsFailed: 0,
      listingComplete: true,
      recordsDeferred: 0,
      notebookCursor: {
        retryReport: [
          {
            guid: guid(failedIndex),
            title: `Sanitized note ${failedIndex}`,
            status: "recovered",
          },
        ],
      },
    });
  });

  it("streams the sanitized production text listing without structured rows", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    const fixture = noteListingFixture.textContentForm;
    const records: string[] = [];
    let searchCalls = 0;
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        if (input.name === "search_notes") {
          searchCalls += 1;
          return fixture;
        }
        if (input.name === "get_note") {
          return {
            structuredContent: {
              id: input.arguments?.noteId,
              title: "[REDACTED_TITLE]",
              content: "<en-note>[REDACTED_CONTENT]</en-note>",
            },
          };
        }
        throw new Error(`Unexpected tool ${input.name}`);
      },
    };

    const result = await streamEvernoteViaMcp(client, {
      syncRunId: "text-listing",
      taxonomy: { notebooks: [], tags: [], spaces: [] },
      loadKnownNotes: async () => new Map(),
      processBatch: async (batch) => {
        records.push(...batch.records.map((record) => record.externalId));
      },
      maxBatchesPerInvocation: 2,
    });

    expect(searchCalls).toBe(1);
    expect(records).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(result).toMatchObject({
      startIndex: 2,
      expectedTotal: 4927,
      recordsDeferred: 4925,
    });
  });

  it("retries one parsed-empty page before continuing", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    let searchCalls = 0;
    const processBatch = vi.fn();
    const client = {
      async callTool(input: {
        name: string;
        arguments?: Record<string, unknown>;
      }): Promise<unknown> {
        if (input.name === "search_notes") {
          searchCalls += 1;
          if (searchCalls === 1) {
            return {
              structuredContent: { totalResultCount: 1 },
              content: [
                {
                  type: "text",
                  text: "Showing 0 of 1 (startIndex=0, more available).",
                },
              ],
            };
          }
          return {
            structuredContent: { totalResultCount: 1 },
            content: [
              {
                type: "text",
                text: "1. 55555555-5555-4555-8555-555555555555 — [REDACTED_TITLE]\n\nShowing 1 of 1 (startIndex=0).",
              },
            ],
          };
        }
        if (input.name === "get_note") {
          return {
            structuredContent: {
              id: input.arguments?.noteId,
              content: "<en-note>[REDACTED_CONTENT]</en-note>",
            },
          };
        }
        throw new Error(`Unexpected tool ${input.name}`);
      },
    };

    const result = await streamEvernoteViaMcp(client, {
      syncRunId: "empty-retry",
      taxonomy: { notebooks: [], tags: [], spaces: [] },
      loadKnownNotes: async () => new Map(),
      processBatch,
    });

    expect(searchCalls).toBe(2);
    expect(processBatch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      startIndex: 1,
      expectedTotal: 1,
      listingComplete: true,
    });
  });

  it("fails after two positive-total empty pages without checkpointing", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    let searchCalls = 0;
    const processBatch = vi.fn();
    const client = {
      async callTool(input: { name: string }): Promise<unknown> {
        if (input.name !== "search_notes") {
          throw new Error(`Unexpected tool ${input.name}`);
        }
        searchCalls += 1;
        return {
          structuredContent: { totalResultCount: 4927 },
          content: [
            {
              type: "text",
              text: "Showing 0 of 4927 (startIndex=0, more available).",
            },
          ],
        };
      },
    };

    await expect(
      streamEvernoteViaMcp(client, {
        syncRunId: "empty-twice",
        taxonomy: { notebooks: [], tags: [], spaces: [] },
        loadKnownNotes: async () => new Map(),
        processBatch,
      }),
    ).rejects.toThrow("note listing ended early at 0 of 4927");
    expect(searchCalls).toBe(2);
    expect(processBatch).not.toHaveBeenCalled();
  });

  it("fails after two empty pages that report more without a total", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    let searchCalls = 0;
    const processBatch = vi.fn();
    const client = {
      async callTool(input: { name: string }): Promise<unknown> {
        if (input.name !== "search_notes") {
          throw new Error(`Unexpected tool ${input.name}`);
        }
        searchCalls += 1;
        return {
          structuredContent: {
            data: {
              noteList: [],
              pageInfo: { startIndex: 0, hasMore: true },
            },
          },
        };
      },
    };

    await expect(
      streamEvernoteViaMcp(client, {
        syncRunId: "empty-more",
        taxonomy: { notebooks: [], tags: [], spaces: [] },
        loadKnownNotes: async () => new Map(),
        processBatch,
      }),
    ).rejects.toThrow("note listing ended early at 0 with more available");
    expect(searchCalls).toBe(2);
    expect(processBatch).not.toHaveBeenCalled();
  });

  it("retries and defers a mismatched listing offset without advancing", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    let searchCalls = 0;
    const processBatch = vi.fn();
    const client = {
      async callTool(input: { name: string }): Promise<unknown> {
        if (input.name !== "search_notes") {
          throw new Error(`Unexpected tool ${input.name}`);
        }
        searchCalls += 1;
        return {
          structuredContent: { totalResultCount: 4 },
          content: [
            {
              type: "text",
              text: "1. 66666666-6666-4666-8666-666666666666 — [REDACTED_TITLE]\n2. 77777777-7777-4777-8777-777777777777 — [REDACTED_TITLE]\n\nShowing 2 of 4 (startIndex=0, more available).",
            },
          ],
        };
      },
    };

    await expect(
      streamEvernoteViaMcp(client, {
        syncRunId: "offset-mismatch",
        checkpoint: {
          startIndex: 2,
          expectedTotal: 4,
          recordsFetched: 2,
        },
        taxonomy: { notebooks: [], tags: [], spaces: [] },
        loadKnownNotes: async () => new Map(),
        processBatch,
      }),
    ).rejects.toMatchObject({
      status: 503,
      evernoteTransient: true,
    });
    expect(searchCalls).toBe(2);
    expect(processBatch).not.toHaveBeenCalled();
  });

  it("lists locally, fetches only changed note bodies, and normalizes GUID evidence", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    const calls: Array<{ name: string; arguments?: Record<string, unknown> }> =
      [];
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
    expect(
      calls.every(
        (call) => call.name.startsWith("search_") || call.name === "get_note",
      ),
    ).toBe(true);
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

  it("retries an MCP 503 backend read error", async () => {
    process.env.EVERNOTE_MCP_PACE_MS = "0";
    process.env.EVERNOTE_MCP_MAX_429_RETRIES = "1";
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal("setTimeout", (callback: () => void) => {
      callback();
      return 0;
    });
    let calls = 0;
    const client = {
      async callTool(input: { name: string }): Promise<unknown> {
        if (input.name !== "search_notes") {
          throw new Error(`Unexpected tool ${input.name}`);
        }
        calls += 1;
        if (calls === 1) {
          return {
            isError: true,
            structuredContent: { status: 503 },
            content: [{ type: "text", text: "503 backend read error" }],
          };
        }
        return {
          structuredContent: {
            totalResultCount: 0,
            notes: [],
          },
        };
      },
    };

    const result = await fetchEvernoteViaMcp(client, new Map());

    expect(calls).toBe(2);
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
              notes: [
                { id: "limited-note", updatedAt: "2026-10-17T00:00:00Z" },
              ],
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
              notes: [
                { id: "note-limited", updatedAt: "2026-10-17T00:00:00Z" },
              ],
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
    expect(calls.filter((call) => call === "search_notebooks:")).toHaveLength(
      2,
    );
    expect(resumedProgress.at(-1)).toMatchObject({
      stage: "complete",
      notebooksFound: 120,
      tagsFound: 125,
    });
    expect(
      resumedProgress.every(
        (progress) =>
          progress.searchesDone >= 10 && progress.prefixesQueued >= 0,
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
    expect(checkpoints).toEqual(
      Array.from({ length: 55 }, (_, index) => index + 1),
    );
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
