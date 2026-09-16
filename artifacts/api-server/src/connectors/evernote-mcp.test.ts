import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evernoteMcpFetch,
  evernoteMcpAuthorizationCode,
  fetchEvernoteViaMcp,
  mcpOAuthStateFromSettings,
  mcpSettingsFromOAuthState,
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
  it("retries HTTP 429 using Retry-After before the SDK consumes headers", async () => {
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
    let notebookCalls = 0;
    const client = {
      async callTool(input: { name: string }): Promise<unknown> {
        if (input.name === "search_notebooks") {
          notebookCalls += 1;
          if (notebookCalls === 1) {
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
          return { structuredContent: { notebooks: [] } };
        }
        if (input.name === "search_tags") {
          return { structuredContent: { tags: [] } };
        }
        if (input.name === "search_notes") {
          return {
            structuredContent: { totalResultCount: 0, notes: [] },
          };
        }
        throw new Error(`Unexpected tool ${input.name}`);
      },
    };
    const result = await fetchEvernoteViaMcp(client, new Map());
    expect(notebookCalls).toBe(2);
    expect(result.recordsFetched).toBe(0);
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
});
