import {
  Client,
  StreamableHTTPClientTransport,
  auth,
  type OAuthClientInformationContext,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import {
  evernoteContentHash,
  evernoteEnmlToText,
  type EvernoteFetchResult,
  type EvernoteKnownNote,
  type EvernoteRawRecord,
} from "./evernote";

export const EVERNOTE_MCP_URL = "https://mcp.evernote.com/mcp";
const READ_TOOLS = new Set([
  "search_notes",
  "semantic_search",
  "get_note",
  "search_notebooks",
  "search_tags",
]);

type JsonRecord = Record<string, unknown>;

export type EvernoteMcpOAuthState = {
  oauthState: string;
  clientInformation?: StoredOAuthClientInformation;
  clientSecret?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenMetadata?: Omit<StoredOAuthTokens, "access_token" | "refresh_token">;
  codeVerifier?: string | null;
  discoveryState?: OAuthDiscoveryState;
};

export type EvernoteMcpConnectorSettings = {
  authTransport: "mcp";
  mcpServerUrl: string;
  mcpOAuthState: string;
  mcpClientInformation?: StoredOAuthClientInformation;
  clientSecret?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  mcpTokenMetadata?: Omit<StoredOAuthTokens, "access_token" | "refresh_token">;
  token?: string | null;
  mcpDiscoveryState?: OAuthDiscoveryState;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstArray(root: JsonRecord, keys: string[]): unknown[] {
  for (const key of keys) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  const data = asRecord(root.data);
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key] as unknown[];
  }
  return [];
}

function stripClientSecret(
  value: StoredOAuthClientInformation,
): {
  information: StoredOAuthClientInformation;
  secret: string | null;
} {
  const row = { ...value } as StoredOAuthClientInformation & {
    client_secret?: string;
  };
  const secret = row.client_secret ?? null;
  delete row.client_secret;
  return { information: row, secret };
}

function stripTokens(value: StoredOAuthTokens): {
  accessToken: string;
  refreshToken: string | null;
  metadata: Omit<StoredOAuthTokens, "access_token" | "refresh_token">;
} {
  const row = { ...value } as Record<string, unknown>;
  const accessToken = String(row.access_token ?? "");
  const refreshToken = asString(row.refresh_token);
  delete row.access_token;
  delete row.refresh_token;
  // Recall does not use identity tokens; never retain one in unsealed metadata.
  delete row.id_token;
  return {
    accessToken,
    refreshToken: refreshToken ?? null,
    metadata: row as Omit<
      StoredOAuthTokens,
      "access_token" | "refresh_token"
    >,
  };
}

export function mcpOAuthStateFromSettings(
  settings: Record<string, unknown>,
): EvernoteMcpOAuthState {
  const clientInformation = asRecord(
    settings.mcpClientInformation,
  ) as StoredOAuthClientInformation;
  const clientId = asString(clientInformation.client_id);
  const clientSecret = asString(settings.clientSecret);
  return {
    oauthState: asString(settings.mcpOAuthState) ?? "",
    clientInformation: clientId
      ? ({
          ...clientInformation,
          ...(clientSecret ? { client_secret: clientSecret } : {}),
        } as StoredOAuthClientInformation)
      : undefined,
    clientSecret,
    accessToken: asString(settings.accessToken),
    refreshToken: asString(settings.refreshToken),
    tokenMetadata: asRecord(
      settings.mcpTokenMetadata,
    ) as EvernoteMcpOAuthState["tokenMetadata"],
    codeVerifier: asString(settings.token),
    discoveryState: Object.keys(asRecord(settings.mcpDiscoveryState)).length
      ? (settings.mcpDiscoveryState as OAuthDiscoveryState)
      : undefined,
  };
}

export function mcpSettingsFromOAuthState(
  state: EvernoteMcpOAuthState,
): EvernoteMcpConnectorSettings {
  const client = state.clientInformation
    ? stripClientSecret(state.clientInformation)
    : null;
  return {
    authTransport: "mcp",
    mcpServerUrl: EVERNOTE_MCP_URL,
    mcpOAuthState: state.oauthState,
    mcpClientInformation: client?.information,
    clientSecret: client?.secret ?? state.clientSecret ?? null,
    accessToken: state.accessToken ?? null,
    refreshToken: state.refreshToken ?? null,
    mcpTokenMetadata: state.tokenMetadata,
    token: state.codeVerifier ?? null,
    mcpDiscoveryState: state.discoveryState,
  };
}

class RecallEvernoteMcpOAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | null = null;

  constructor(
    private readonly stateValue: EvernoteMcpOAuthState,
    private readonly callbackUrl: string,
    private readonly onStateChanged?: (
      settings: EvernoteMcpConnectorSettings,
    ) => Promise<void>,
  ) {}

  private async persist(): Promise<void> {
    await this.onStateChanged?.(mcpSettingsFromOAuthState(this.stateValue));
  }

  get redirectUrl(): string {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Recall",
      client_uri: "https://recall-app.net",
      redirect_uris: [this.callbackUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "read",
    };
  }

  state(): string {
    return this.stateValue.oauthState;
  }

  clientInformation(
    _ctx?: OAuthClientInformationContext,
  ): StoredOAuthClientInformation | undefined {
    return this.stateValue.clientInformation;
  }

  async saveClientInformation(
    information: StoredOAuthClientInformation,
    _ctx?: OAuthClientInformationContext,
  ): Promise<void> {
    const split = stripClientSecret(information);
    this.stateValue.clientInformation = {
      ...split.information,
      ...(split.secret ? { client_secret: split.secret } : {}),
    } as StoredOAuthClientInformation;
    this.stateValue.clientSecret = split.secret;
    await this.persist();
  }

  tokens(_ctx?: OAuthClientInformationContext): StoredOAuthTokens | undefined {
    if (!this.stateValue.accessToken) return undefined;
    return {
      ...(this.stateValue.tokenMetadata ?? {}),
      access_token: this.stateValue.accessToken,
      ...(this.stateValue.refreshToken
        ? { refresh_token: this.stateValue.refreshToken }
        : {}),
    } as StoredOAuthTokens;
  }

  async saveTokens(
    tokens: StoredOAuthTokens,
    _ctx?: OAuthClientInformationContext,
  ): Promise<void> {
    const split = stripTokens(tokens);
    this.stateValue.accessToken = split.accessToken;
    this.stateValue.refreshToken = split.refreshToken;
    this.stateValue.tokenMetadata = split.metadata;
    await this.persist();
  }

  redirectToAuthorization(url: URL): void {
    this.authorizationUrl = url;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.stateValue.codeVerifier = codeVerifier;
    await this.persist();
  }

  codeVerifier(): string {
    if (!this.stateValue.codeVerifier) {
      throw new Error("Evernote MCP OAuth code verifier is missing");
    }
    return this.stateValue.codeVerifier;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this.stateValue.discoveryState = state;
    await this.persist();
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.stateValue.discoveryState;
  }
}

function callbackUrl(): string {
  return (
    process.env.EVERNOTE_OAUTH_REDIRECT_URI?.trim() ||
    "https://recall-app.net/api/connectors/evernote/oauth/callback"
  );
}

function mcpServerUrl(): URL {
  const configured = process.env.EVERNOTE_MCP_URL?.trim() || EVERNOTE_MCP_URL;
  const url = new URL(configured);
  if (url.protocol !== "https:") {
    throw new Error("EVERNOTE_MCP_URL must use HTTPS");
  }
  return url;
}

export async function beginEvernoteMcpOAuth(
  oauthState: string,
  existingSettings?: Record<string, unknown>,
): Promise<{
  authorizeUrl: string;
  settings: EvernoteMcpConnectorSettings;
}> {
  const state: EvernoteMcpOAuthState = existingSettings
    ? mcpOAuthStateFromSettings(existingSettings)
    : { oauthState };
  state.oauthState = oauthState;
  const provider = new RecallEvernoteMcpOAuthProvider(state, callbackUrl());
  const result = await auth(provider, {
    serverUrl: mcpServerUrl(),
    scope: "read",
    forceReauthorization: true,
  });
  if (result !== "REDIRECT") {
    throw new Error("Evernote MCP OAuth unexpectedly completed without consent");
  }
  if (!provider.authorizationUrl) {
    throw new Error("Evernote MCP did not start OAuth authorization");
  }
  return {
    authorizeUrl: provider.authorizationUrl.toString(),
    settings: mcpSettingsFromOAuthState(state),
  };
}

export async function finishEvernoteMcpOAuth(
  settings: Record<string, unknown>,
  callbackParams: URLSearchParams,
  onStateChanged?: (
    settings: EvernoteMcpConnectorSettings,
  ) => Promise<void>,
): Promise<EvernoteMcpConnectorSettings> {
  const state = mcpOAuthStateFromSettings(settings);
  const provider = new RecallEvernoteMcpOAuthProvider(
    state,
    callbackUrl(),
    onStateChanged,
  );
  const authorizationCode = callbackParams.get("code");
  if (!authorizationCode) {
    throw new Error("Evernote MCP OAuth callback is missing code");
  }
  await auth(provider, {
    serverUrl: mcpServerUrl(),
    authorizationCode,
    iss: callbackParams.get("iss") ?? undefined,
    scope: "read",
  });
  return mcpSettingsFromOAuthState(state);
}

type ToolCaller = {
  callTool(input: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<unknown>;
};

async function callReadTool(
  client: ToolCaller,
  name: string,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  if (!READ_TOOLS.has(name)) {
    throw new Error(`Evernote MCP write/non-sync tool blocked: ${name}`);
  }
  const configuredRetries = Number(
    process.env.EVERNOTE_MCP_MAX_429_RETRIES ?? 2,
  );
  const maxRetries = Number.isFinite(configuredRetries)
    ? Math.min(Math.max(Math.floor(configuredRetries), 0), 4)
    : 2;
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = asRecord(await client.callTool({ name, arguments: args }));
      const text = asArray(raw.content)
        .map((part) => asRecord(part))
        .find(
          (part) => part.type === "text" && typeof part.text === "string",
        )?.text;
      if (raw.isError === true) {
        const error = new Error(
          typeof text === "string"
            ? text.slice(0, 300)
            : `Evernote MCP ${name} failed`,
        ) as Error & { status?: number; retryAfterMs?: number };
        if (/\b429\b|rate.?limit/i.test(error.message)) {
          error.status = 429;
          error.retryAfterMs = 1_000;
        }
        throw error;
      }
      if (raw.structuredContent !== undefined) {
        return asRecord(raw.structuredContent);
      }
      if (typeof text !== "string") return raw;
      try {
        return asRecord(JSON.parse(text));
      } catch {
        return { text };
      }
    } catch (error) {
      const row = asRecord(error);
      const data = asRecord(row.data);
      const status = asNumber(
        row.status ?? row.statusCode ?? data.status ?? data.statusCode,
      );
      const message = error instanceof Error ? error.message : "";
      const rateLimited =
        status === 429 || /\b429\b|rate.?limit/i.test(message);
      if (!rateLimited || attempt >= maxRetries) throw error;
      const retryValue =
        asNumber(
          row.retryAfterMs ??
            row.retry_after_ms ??
            data.retryAfterMs ??
            data.retry_after_ms,
        ) ??
        ((asNumber(
          row.retryAfter ??
            row.retry_after ??
            data.retryAfter ??
            data.retry_after,
        ) ??
          Number(message.match(/retry after\s+(\d+)/i)?.[1] ?? 1)) *
          1_000);
      const boundedDelay = Math.min(
        Math.max(retryValue, 0),
        60_000,
      );
      await new Promise((resolve) => setTimeout(resolve, boundedDelay));
    }
  }
}

function idAndName(value: unknown): { id: string; name: string } | null {
  const row = asRecord(value);
  const id =
    asString(row.id) ??
    asString(row.guid) ??
    asString(row.noteId) ??
    asString(row.notebookId) ??
    asString(row.tagId);
  if (!id) return null;
  return {
    id,
    name:
      asString(row.name) ??
      asString(row.label) ??
      asString(row.title) ??
      id,
  };
}

function noteGuid(value: unknown): string | null {
  const row = asRecord(value);
  return asString(row.id) ?? asString(row.guid) ?? asString(row.noteId);
}

function noteUpdated(value: unknown): string | null {
  const row = asRecord(value);
  return (
    asString(row.updated) ??
    asString(row.updatedAt) ??
    asString(row.updateTime) ??
    null
  );
}

function iso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 10_000_000_000 ? value * 1_000 : value;
    return new Date(millis).toISOString();
  }
  const text = asString(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function deepLink(guid: string, row: JsonRecord): string {
  return (
    asString(row.webUrl) ??
    asString(row.url) ??
    asString(row.deepLink) ??
    `https://www.evernote.com/client/web#?an=true&n=${encodeURIComponent(guid)}`
  );
}

function noteToRaw(
  raw: JsonRecord,
  notebooks: Map<string, string>,
  tags: Map<string, string>,
): EvernoteRawRecord {
  const guid = noteGuid(raw);
  if (!guid) throw new Error("Evernote MCP note is missing a GUID");
  const structured = asRecord(raw.structuredContent);
  const title = asString(raw.title) ?? "Untitled";
  const enml =
    asString(raw.content) ??
    asString(raw.enml) ??
    asString(raw.body) ??
    "";
  const text = evernoteEnmlToText(enml);
  const notebookGuid =
    asString(raw.notebookId) ??
    asString(raw.notebookGuid) ??
    asString(structured.notebookId);
  const notebookName =
    asString(raw.notebookName) ??
    (notebookGuid ? notebooks.get(notebookGuid) ?? notebookGuid : null);
  const tagRows = [
    ...asArray(raw.tags),
    ...asArray(structured.tags),
  ];
  const parsedTags = tagRows
    .map(idAndName)
    .filter((tag): tag is { id: string; name: string } => Boolean(tag));
  const tagGuids =
    parsedTags.length > 0
      ? parsedTags.map((tag) => tag.id)
      : asArray(raw.tagIds)
          .map(asString)
          .filter((tag): tag is string => Boolean(tag));
  const tagNames = tagGuids.map(
    (tagGuid) =>
      parsedTags.find((tag) => tag.id === tagGuid)?.name ??
      tags.get(tagGuid) ??
      tagGuid,
  );
  const resources = [
    ...asArray(raw.resources),
    ...asArray(structured.resources),
  ];
  const sourceCreatedAt = iso(raw.created ?? raw.createdAt);
  const sourceUpdatedAt = iso(raw.updated ?? raw.updatedAt);
  const sourceUrl = deepLink(guid, raw);
  const contentHash = evernoteContentHash({
    title,
    text,
    notebookName,
    tags: tagNames,
    sourceUrl,
  });
  return {
    externalId: guid,
    recordType: "evernote_note",
    recordTitle: title,
    recordText: [
      "Evernote note source=evernote_note transport=mcp",
      notebookName ? `notebook: ${notebookName}` : null,
      tagNames.length ? `tags: ${tagNames.join(", ")}` : null,
      text,
    ]
      .filter(Boolean)
      .join("\n"),
    sourceUrl,
    sourceCreatedAt,
    sourceUpdatedAt,
    metadata: {
      contentHash,
      usn:
        asNumber(raw.usn ?? raw.version ?? raw.updateSequenceNum) ?? null,
      notebookGuid,
      notebookName,
      tagGuids,
      tagNames,
      evernoteUpdated: sourceUpdatedAt,
      hasAttachments: resources.length > 0,
    },
  };
}

function paceMs(): number {
  const configured = Number(process.env.EVERNOTE_MCP_PACE_MS ?? 1_000);
  if (!Number.isFinite(configured)) return 1_000;
  return Math.min(Math.max(Math.floor(configured), 0), 10_000);
}

async function pace(): Promise<void> {
  const delay = paceMs();
  if (delay <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

export async function fetchEvernoteViaMcp(
  client: ToolCaller,
  knownNotes: Map<string, EvernoteKnownNote>,
): Promise<EvernoteFetchResult> {
  const notebookResult = await callReadTool(client, "search_notebooks", {
    query: "",
    maxResults: 100,
    sortBy: "name",
  });
  await pace();
  const tagResult = await callReadTool(client, "search_tags", {
    query: "",
    maxResults: 100,
    sortBy: "name",
  });
  await pace();
  const notebooks = new Map(
    firstArray(notebookResult, ["notebooks", "results", "items"])
      .map(idAndName)
      .filter((item): item is { id: string; name: string } => Boolean(item))
      .map((item) => [item.id, item.name] as const),
  );
  const tags = new Map(
    firstArray(tagResult, ["tags", "results", "items"])
      .map(idAndName)
      .filter((item): item is { id: string; name: string } => Boolean(item))
      .map((item) => [item.id, item.name] as const),
  );

  const summaries: unknown[] = [];
  let startIndex = 0;
  let total = Number.POSITIVE_INFINITY;
  let explicitTotal: number | null = null;
  let listingComplete = false;
  while (startIndex < total) {
    const result = await callReadTool(client, "search_notes", {
      query: "",
      maxResults: 100,
      startIndex,
      sortBy: "updated",
      ascending: false,
    });
    const page = firstArray(result, ["notes", "results", "items"]);
    summaries.push(...page);
    const reportedTotal = asNumber(
      result.totalResultCount ?? result.total ?? result.totalNotes,
    );
    if (reportedTotal != null) {
      if (explicitTotal != null && explicitTotal !== reportedTotal) {
        throw new Error(
          `Evernote MCP note total changed during sync (${explicitTotal} to ${reportedTotal})`,
        );
      }
      explicitTotal = reportedTotal;
      total = reportedTotal;
    }
    if (page.length === 0) {
      if (explicitTotal != null && startIndex < explicitTotal) {
        throw new Error(
          `Evernote MCP note listing ended early at ${startIndex} of ${explicitTotal}`,
        );
      }
      listingComplete = true;
      break;
    }
    startIndex += page.length;
    if (explicitTotal != null && startIndex >= explicitTotal) {
      listingComplete = true;
    } else if (explicitTotal == null && page.length < 100) {
      listingComplete = true;
      break;
    }
    await pace();
  }

  const activeGuids = new Set(
    summaries.map(noteGuid).filter((guid): guid is string => Boolean(guid)),
  );
  // Offset listings can shift while notes are concurrently edited. Reconcile
  // deletions only when every reported row was consumed with no duplicate gap.
  const authoritativeListing =
    listingComplete &&
    explicitTotal != null &&
    summaries.length === explicitTotal &&
    activeGuids.size === explicitTotal;
  const deletedExternalIds = authoritativeListing
    ? [...knownNotes.keys()].filter((guid) => !activeGuids.has(guid))
    : [];
  const changed = summaries.filter((summary) => {
    const guid = noteGuid(summary);
    if (!guid) return false;
    const known = knownNotes.get(guid);
    const updated = noteUpdated(summary);
    return !known || !updated || known.evernoteUpdated !== iso(updated);
  });

  const records: EvernoteRawRecord[] = [];
  const errors: string[] = [];
  for (const summary of changed) {
    const guid = noteGuid(summary);
    if (!guid) continue;
    try {
      const note = await callReadTool(client, "get_note", { noteId: guid });
      records.push(noteToRaw(note, notebooks, tags));
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message.slice(0, 300)
          : `Evernote MCP get_note failed for ${guid}`,
      );
    }
    await pace();
  }

  return {
    records,
    recordsFetched: activeGuids.size,
    recordsSkipped: activeGuids.size - changed.length,
    recordsFailed: errors.length,
    deletedExternalIds,
    errors,
  };
}

export async function withEvernoteMcpClient<T>(
  settings: Record<string, unknown>,
  operation: (client: ToolCaller) => Promise<T>,
  onStateChanged?: (
    settings: EvernoteMcpConnectorSettings,
  ) => Promise<void>,
): Promise<{
  value: T;
  settings: EvernoteMcpConnectorSettings;
}> {
  const state = mcpOAuthStateFromSettings(settings);
  const provider = new RecallEvernoteMcpOAuthProvider(
    state,
    callbackUrl(),
    onStateChanged,
  );
  const transport = new StreamableHTTPClientTransport(mcpServerUrl(), {
    authProvider: provider,
  });
  const client = new Client({ name: "Recall", version: "1.0.0" });
  try {
    await client.connect(transport);
    const value = await operation(client);
    return { value, settings: mcpSettingsFromOAuthState(state) };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function testEvernoteMcpConnection(
  settings: Record<string, unknown>,
  onStateChanged?: (
    settings: EvernoteMcpConnectorSettings,
  ) => Promise<void>,
): Promise<{
  notebookCount: number;
  tagCount: number;
  settings: EvernoteMcpConnectorSettings;
}> {
  const result = await withEvernoteMcpClient(settings, async (client) => {
    const notebooks = await callReadTool(client, "search_notebooks", {
      query: "",
      maxResults: 100,
      sortBy: "name",
    });
    await pace();
    const tags = await callReadTool(client, "search_tags", {
      query: "",
      maxResults: 100,
      sortBy: "name",
    });
    return {
      notebookCount: firstArray(notebooks, ["notebooks", "results", "items"])
        .length,
      tagCount: firstArray(tags, ["tags", "results", "items"]).length,
    };
  }, onStateChanged);
  return { ...result.value, settings: result.settings };
}
