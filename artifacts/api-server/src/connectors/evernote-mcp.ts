import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  auth,
  type OAuthClientInformationContext,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type FetchLike,
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
  "search_tasks",
  "get_task",
  "get_attachment",
  "search_spaces",
  "get_space",
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

function max429Retries(): number {
  const configured = Number(
    process.env.EVERNOTE_MCP_MAX_429_RETRIES ?? 2,
  );
  return Number.isFinite(configured)
    ? Math.min(Math.max(Math.floor(configured), 0), 4)
    : 2;
}

function retryAfterHeaderMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

type EvernoteMcpFetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type EvernoteMcpFetchOptions = {
  fetchFn?: EvernoteMcpFetchImplementation;
  maxRetries?: number;
};

export function evernoteRateLimitBackoffMs(
  attempt: number,
  retryAfterMs: number | null,
  random = Math.random(),
): number {
  const exponential = Math.min(
    1_000 * 2 ** Math.max(0, Math.floor(attempt)),
    60_000,
  );
  const jitter = Math.floor(
    exponential * 0.25 * Math.min(Math.max(random, 0), 1),
  );
  return Math.min(
    3_600_000,
    Math.max(exponential, retryAfterMs ?? 0) + jitter,
  );
}

function evernoteRateLimitError(
  error: unknown,
  retryAfterMs: number,
): Error & {
  status: number;
  retryAfterMs: number;
  evernoteRateLimited: true;
} {
  const wrapped = new Error(
    error instanceof Error ? error.message : "Evernote MCP rate limit",
    { cause: error },
  ) as Error & {
    status: number;
    retryAfterMs: number;
    evernoteRateLimited: true;
  };
  wrapped.status = 429;
  wrapped.retryAfterMs = retryAfterMs;
  wrapped.evernoteRateLimited = true;
  return wrapped;
}

export async function evernoteMcpFetch(
  input: string | URL | Request,
  init?: Parameters<FetchLike>[1],
  options?: EvernoteMcpFetchOptions,
): Promise<Response> {
  const retries = options?.maxRetries ?? max429Retries();
  for (let attempt = 0; ; attempt++) {
    const request = input instanceof Request ? input.clone() : input;
    const response = options?.fetchFn
      ? await options.fetchFn(request, init)
      : await fetch(request, init);
    if (response.status !== 429) return response;
    const retryAfterMs =
      retryAfterHeaderMs(response.headers.get("retry-after")) ?? 1_000;
    const backoffMs = evernoteRateLimitBackoffMs(attempt, retryAfterMs);
    if (attempt >= retries) {
      const error = new Error(
        `Evernote MCP HTTP 429 after ${attempt + 1} request(s)`,
      ) as Error & {
        status: number;
        mcpRetriesExhausted: boolean;
        retryAfterMs: number;
        evernoteRateLimited: true;
      };
      error.status = 429;
      error.mcpRetriesExhausted = true;
      error.retryAfterMs = backoffMs;
      error.evernoteRateLimited = true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
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
    fetchFn: evernoteMcpFetch,
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
  const authorizationCode = evernoteMcpAuthorizationCode(callbackParams);
  await auth(provider, {
    serverUrl: mcpServerUrl(),
    authorizationCode,
    iss: callbackParams.get("iss") ?? undefined,
    scope: "read",
    fetchFn: evernoteMcpFetch,
  });
  return mcpSettingsFromOAuthState(state);
}

export function evernoteMcpAuthorizationCode(
  callbackParams: URLSearchParams,
): string {
  const authorizationCode = callbackParams.get("code");
  if (!authorizationCode) {
    const oauthError =
      callbackParams.get("error_description") ??
      callbackParams.get("error") ??
      "Evernote MCP OAuth callback is missing code";
    throw new Error(oauthError.slice(0, 300));
  }
  return authorizationCode;
}

export type EvernoteReadOnlyToolCaller = {
  callTool(input: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<unknown>;
};

export class EvernoteReadOnlyViolation extends Error {
  readonly toolName: string;

  constructor(toolName: string) {
    super(
      `Evernote read-only policy blocked MCP tool: ${toolName || "(empty name)"}`,
    );
    this.name = "EvernoteReadOnlyViolation";
    this.toolName = toolName;
  }
}

const READ_ONLY_TOOL_NAME =
  /^(?:search_[a-z_]+|get_[a-z_]+|semantic_search|get_attachment)$/;

export function createEvernoteReadOnlyCaller(
  client: EvernoteReadOnlyToolCaller,
): EvernoteReadOnlyToolCaller {
  return Object.freeze({
    async callTool(input) {
      const name = input.name;
      if (!READ_ONLY_TOOL_NAME.test(name)) {
        throw new EvernoteReadOnlyViolation(name);
      }
      return client.callTool({ name, arguments: input.arguments });
    },
  });
}

function invokeTool(
  client: EvernoteReadOnlyToolCaller,
  input: Parameters<EvernoteReadOnlyToolCaller["callTool"]>[0],
): Promise<unknown> {
  const callTool = client.callTool;
  return callTool.call(client, input);
}

function parseToolResult(raw: JsonRecord, name: string): JsonRecord {
  const text = asArray(raw.content)
    .map((part) => asRecord(part))
    .find(
      (part) => part.type === "text" && typeof part.text === "string",
    )?.text;
  if (raw.isError === true) {
    const structuredError = asRecord(raw.structuredContent);
    const error = new Error(
      typeof text === "string"
        ? text.slice(0, 300)
        : `Evernote MCP ${name} failed`,
    ) as Error & { status?: number; retryAfterMs?: number };
    const structuredStatus = asNumber(
      structuredError.status ?? structuredError.statusCode,
    );
    if (structuredStatus != null) error.status = structuredStatus;
    if (
      structuredStatus === 429 ||
      /\b429\b|rate.?limit/i.test(error.message)
    ) {
      error.status = 429;
      const retryMs = asNumber(
        structuredError.retryAfterMs ??
          structuredError.retry_after_ms,
      );
      const retrySeconds = asNumber(
        structuredError.retryAfter ??
          structuredError.retry_after,
      );
      error.retryAfterMs =
        retryMs ?? (retrySeconds != null ? retrySeconds * 1_000 : undefined);
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
}

async function callReadTool(
  client: EvernoteReadOnlyToolCaller,
  name: string,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  if (!READ_TOOLS.has(name)) {
    throw new Error(`Evernote MCP write/non-sync tool blocked: ${name}`);
  }
  const maxRetries = max429Retries();
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = asRecord(
        await invokeTool(client, { name, arguments: args }),
      );
      return parseToolResult(raw, name);
    } catch (error) {
      const row = asRecord(error);
      const data = asRecord(row.data);
      const status = asNumber(
        row.status ?? row.statusCode ?? data.status ?? data.statusCode,
      );
      const message = error instanceof Error ? error.message : "";
      const rateLimited =
        status === 429 || /\b429\b|rate.?limit/i.test(message);
      if (!rateLimited) throw error;
      const headersValue = row.headers ?? data.headers;
      const headerRetryAfter =
        headersValue instanceof Headers
          ? headersValue.get("retry-after")
          : asString(
              asRecord(headersValue)["retry-after"] ??
                asRecord(headersValue)["Retry-After"],
            );
      const headerSeconds = headerRetryAfter
        ? Number(headerRetryAfter)
        : Number.NaN;
      const headerDate = headerRetryAfter
        ? Date.parse(headerRetryAfter)
        : Number.NaN;
      const headerDelay = Number.isFinite(headerSeconds)
        ? headerSeconds * 1_000
        : Number.isFinite(headerDate)
          ? Math.max(0, headerDate - Date.now())
          : null;
      const messageMatch = message.match(
        /retry after\s+(\d+)\s*(ms|milliseconds?|s|sec|seconds?|m|min|minutes?)?/i,
      );
      const messageAmount = Number(messageMatch?.[1] ?? Number.NaN);
      const messageUnit = (messageMatch?.[2] ?? "seconds").toLowerCase();
      const messageDelay = Number.isFinite(messageAmount)
        ? messageAmount *
          (messageUnit.startsWith("m") && !messageUnit.startsWith("ms")
            ? 60_000
            : messageUnit.startsWith("ms")
              ? 1
              : 1_000)
        : null;
      const retryAfterMs =
        asNumber(
          row.retryAfterMs ??
            row.retry_after_ms ??
            data.retryAfterMs ??
            data.retry_after_ms,
        ) ??
        (headerDelay ?? messageDelay) ??
        ((asNumber(
          row.retryAfter ??
            row.retry_after ??
            data.retryAfter ??
            data.retry_after,
        ) ??
          1) *
          1_000);
      const boundedDelay = evernoteRateLimitBackoffMs(
        attempt,
        Math.min(Math.max(retryAfterMs, 0), 3_600_000),
      );
      if (
        row.mcpRetriesExhausted === true ||
        attempt >= maxRetries
      ) {
        throw evernoteRateLimitError(error, boundedDelay);
      }
      await new Promise((resolve) => setTimeout(resolve, boundedDelay));
    }
  }
}

/** Read-only escape hatch for the durable worker's attachment/task phases. */
export async function callEvernoteReadTool(
  client: EvernoteReadOnlyToolCaller,
  name: string,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  return callPacedReadTool(client, name, args);
}

function isMcpRateLimitError(error: unknown): boolean {
  const row = asRecord(error);
  const data = asRecord(row.data);
  const status = asNumber(
    row.status ?? row.statusCode ?? data.status ?? data.statusCode,
  );
  const message = error instanceof Error ? error.message : "";
  return status === 429 || /\b429\b|rate.?limit/i.test(message);
}

function idAndName(value: unknown): { id: string; name: string } | null {
  const row = asRecord(value);
  const id =
    boundedScalar(row.id, 500) ??
    boundedScalar(row.guid, 500) ??
    boundedScalar(row.noteId, 500) ??
    boundedScalar(row.notebookId, 500) ??
    boundedScalar(row.tagId, 500);
  if (!id) return null;
  return {
    id,
    name:
      boundedScalar(row.name, 500) ??
      boundedScalar(row.label, 500) ??
      boundedScalar(row.title, 1_000) ??
      id,
  };
}

function noteGuid(value: unknown): string | null {
  const row = asRecord(value);
  for (const candidate of [row.id, row.guid, row.noteId]) {
    if (typeof candidate !== "string") continue;
    const id = candidate.slice(0, 500).trim();
    if (id) return id;
  }
  return null;
}

function noteUpdated(value: unknown): string | null {
  const row = asRecord(value);
  return (
    boundedScalar(row.updated, 100) ??
    boundedScalar(row.updatedAt, 100) ??
    boundedScalar(row.updateTime, 100) ??
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

/**
 * Keep one remote note from dominating the worker heap. Attachments remain
 * metadata-only; resource bytes are never copied into source records.
 */
/** Full ENML is retained. Kept as an export for compatibility with older tests. */
export const EVERNOTE_MAX_NOTE_CONTENT_CHARS = Number.POSITIVE_INFINITY;

function boundedText(value: unknown, max = EVERNOTE_MAX_NOTE_CONTENT_CHARS): {
  text: string;
  truncated: boolean;
} {
  const text = typeof value === "string" ? value : "";
  return Number.isFinite(max) && text.length > max
    ? { text: text.slice(0, max), truncated: true }
    : { text, truncated: false };
}

function firstNoteContent(raw: JsonRecord): string {
  for (const value of [raw.content, raw.enml, raw.body]) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function boundedScalar(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.slice(0, max).trim();
  return text || null;
}

function compactNoteForSync(raw: JsonRecord): JsonRecord {
  const structured = asRecord(raw.structuredContent);
  const content = boundedText(firstNoteContent(raw));
  const compactEntity = (value: unknown): JsonRecord => {
    const row = asRecord(value);
    return {
      id: noteGuid(row),
      name:
        boundedScalar(row.name, 500) ?? boundedScalar(row.label, 500) ?? "",
      title: boundedScalar(row.title, 1_000) ?? "",
      parentId: boundedScalar(row.parentId, 500),
    };
  };
  const compactResource = (value: unknown): JsonRecord => {
    const row = asRecord(value);
    return {
      id:
        boundedScalar(row.id, 500) ??
        boundedScalar(row.guid, 500) ??
        boundedScalar(row.resourceId, 500),
      hash: boundedScalar(row.hash, 128) ?? boundedScalar(row.md5, 128),
      mime: boundedScalar(row.mime, 255) ?? boundedScalar(row.mimeType, 255),
      name:
        boundedScalar(row.name, 2_000) ??
        boundedScalar(row.fileName, 2_000),
      sizeBytes: asNumber(row.sizeBytes ?? row.size),
    };
  };
  const compactTask = (value: unknown): JsonRecord => {
    const row = asRecord(value);
    return {
      id:
        boundedScalar(row.id, 500) ??
        boundedScalar(row.guid, 500) ??
        boundedScalar(row.taskId, 500),
      noteId: boundedScalar(row.noteId, 500),
      label: boundedScalar(row.label, 10_000) ?? "",
      description: boundedScalar(row.description, 50_000),
      status: boundedScalar(row.status, 64),
      dueDate: row.dueDate ?? row.dueAt,
      completedAt: row.completedAt,
      updatedAt: row.updatedAt ?? row.updated,
      priority: boundedScalar(row.priority, 64),
      flagged: row.flagged === true,
      recurring: row.recurring === true,
      assignee: boundedScalar(row.assignee, 500),
    };
  };
  const resources = [
    ...asArray(raw.resources),
    ...asArray(structured.resources),
  ].map(compactResource);
  const tasks = [
    ...asArray(raw.tasks),
    ...asArray(structured.tasks),
  ].map(compactTask);
  return {
    id: noteGuid(raw),
    title: boundedScalar(raw.title, 1_000) ?? "Untitled",
    content: content.text,
    contentTruncated: content.truncated,
    notebookId: boundedScalar(raw.notebookId, 500),
    notebookGuid: boundedScalar(raw.notebookGuid, 500),
    notebookName: boundedScalar(raw.notebookName, 500),
    notebook: compactEntity(raw.notebook),
    tagIds: asArray(raw.tagIds)
      .map((tag) => boundedScalar(tag, 500))
      .filter(Boolean),
    tags: asArray(raw.tags).map(compactEntity),
    created: raw.created,
    createdAt: raw.createdAt,
    updated: raw.updated,
    updatedAt: raw.updatedAt,
    usn: raw.usn,
    version: raw.version,
    updateSequenceNum: raw.updateSequenceNum,
    deleted: raw.deleted,
    trashed: raw.trashed,
    inTrash: raw.inTrash,
    reminderOrder: raw.reminderOrder,
    reminderTime: raw.reminderTime,
    reminderDoneTime: raw.reminderDoneTime,
    webUrl: boundedScalar(raw.webUrl, 2_000),
    url: boundedScalar(raw.url, 2_000),
    deepLink: boundedScalar(raw.deepLink, 2_000),
    resources,
    tasks,
    structuredContent: {
      notebookId: boundedScalar(structured.notebookId, 500),
      tags: asArray(structured.tags).map(compactEntity),
      resources: [],
      tasks: [],
    },
  };
}

function noteToRaw(
  raw: JsonRecord,
  notebooks: Map<string, EvernoteTaxonomyEntity>,
  tags: Map<string, EvernoteTaxonomyEntity>,
): EvernoteRawRecord {
  const guid = noteGuid(raw);
  if (!guid) throw new Error("Evernote MCP note is missing a GUID");
  const structured = asRecord(raw.structuredContent);
  const title = (asString(raw.title) ?? "Untitled").slice(0, 1_000);
  const content = boundedText(firstNoteContent(raw));
  content.truncated ||= raw.contentTruncated === true;
  const text = evernoteEnmlToText(content.text);
  const notebookGuid =
    asString(raw.notebookId) ??
    asString(raw.notebookGuid) ??
    asString(asRecord(raw.notebook).id) ??
    asString(asRecord(raw.notebook).guid) ??
    asString(structured.notebookId);
  const notebookName =
    asString(raw.notebookName) ??
    asString(asRecord(raw.notebook).name) ??
    (notebookGuid ? notebooks.get(notebookGuid)?.name ?? notebookGuid : null);
  const tagRows = [
    ...asArray(raw.tags),
    ...asArray(structured.tags),
  ];
  const parsedTags = [
    ...new Map(
      tagRows
        .map(idAndName)
        .filter((tag): tag is { id: string; name: string } => Boolean(tag))
        .map((tag) => [tag.id, tag] as const),
    ).values(),
  ];
  const tagGuids = [
    ...new Set([
      ...asArray(raw.tagIds)
        .map(asString)
        .filter((tag): tag is string => Boolean(tag)),
      ...parsedTags.map((tag) => tag.id),
    ]),
  ];
  const tagNames = tagGuids.map(
    (tagGuid) =>
      parsedTags.find((tag) => tag.id === tagGuid)?.name ??
      tags.get(tagGuid)?.name ??
      tagGuid,
  );
  const resources = [
    ...asArray(raw.resources),
    ...asArray(structured.resources),
  ];
  const tasks = [
    ...asArray(raw.tasks),
    ...asArray(structured.tasks),
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
    extras: {
      resources,
      tasks,
      trashed:
        raw.trashed === true ||
        raw.inTrash === true ||
        Boolean(raw.deleted),
      reminderOrder: raw.reminderOrder ?? null,
      reminderTime: raw.reminderTime ?? null,
      reminderDoneTime: raw.reminderDoneTime ?? null,
    },
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
      attachments: resources.map((value) => {
        const row = asRecord(value);
        return {
          id:
            boundedScalar(row.id, 500) ??
            boundedScalar(row.guid, 500) ??
            boundedScalar(row.resourceId, 500),
          hash: boundedScalar(row.hash, 128) ?? boundedScalar(row.md5, 128),
          mime:
            boundedScalar(row.mime, 255) ??
            boundedScalar(row.mimeType, 255),
          name:
            boundedScalar(row.name, 2_000) ??
            boundedScalar(row.fileName, 2_000),
          sizeBytes: asNumber(row.sizeBytes ?? row.size),
        };
      }),
      tasks: tasks.map((value) => {
        const row = asRecord(value);
        return {
          id:
            boundedScalar(row.id, 500) ??
            boundedScalar(row.guid, 500) ??
            boundedScalar(row.taskId, 500),
          noteId: boundedScalar(row.noteId, 500) ?? guid,
          label: boundedScalar(row.label, 10_000) ?? "",
          description: boundedScalar(row.description, 50_000),
          status: boundedScalar(row.status, 64),
          dueDate: iso(row.dueDate ?? row.dueAt),
          completedAt: iso(row.completedAt),
          updatedAt: iso(row.updatedAt ?? row.updated),
          priority: boundedScalar(row.priority, 64),
          flagged: row.flagged === true,
          recurring: row.recurring === true,
          assignee: boundedScalar(row.assignee, 500),
        };
      }),
      trashed:
        raw.trashed === true ||
        raw.inTrash === true ||
        Boolean(raw.deleted),
      hasReminder:
        raw.reminderOrder != null ||
        raw.reminderTime != null ||
        raw.reminderDoneTime != null,
      reminderOrder: raw.reminderOrder ?? null,
      reminderTime: iso(raw.reminderTime),
      reminderDoneTime: iso(raw.reminderDoneTime),
      contentTruncated: content.truncated,
    },
  };
}

function paceMs(): number {
  const configured = Number(process.env.EVERNOTE_MCP_PACE_MS ?? 1_000);
  if (!Number.isFinite(configured)) return 1_000;
  return Math.min(Math.max(Math.floor(configured), 0), 10_000);
}

export function evernoteMcpBackfillChunkSize(): number {
  const configured = Number(
    process.env.EVERNOTE_MCP_BACKFILL_CHUNK_SIZE ?? 25,
  );
  if (!Number.isFinite(configured)) return 25;
  return Math.min(Math.max(Math.floor(configured), 1), 100);
}

export type EvernoteTaxonomyEntity = {
  id: string;
  name: string;
  parentId: string | null;
  stack: string | null;
  spaceId: string | null;
  access: string | null;
  metadata: JsonRecord;
};

export type EvernoteTaxonomy = {
  notebooks: EvernoteTaxonomyEntity[];
  tags: EvernoteTaxonomyEntity[];
  spaces: EvernoteTaxonomyEntity[];
};

export type EvernoteTaxonomyCheckpoint = {
  version: 1;
  stage: "notebooks" | "tags" | "spaces" | "complete";
  startedAt: string;
  searchesDone: number;
  frontier: string[];
  visited: string[];
  notebooks: EvernoteTaxonomyEntity[];
  tags: EvernoteTaxonomyEntity[];
  spaces: EvernoteTaxonomyEntity[];
};

export type EvernoteTaxonomyProgress = {
  stage: EvernoteTaxonomyCheckpoint["stage"];
  searchesDone: number;
  prefixesQueued: number;
  notebooksFound: number;
  tagsFound: number;
  spacesFound: number;
  elapsedMs: number;
};

type EvernoteTaxonomyOptions = {
  checkpoint?: unknown;
  checkpointEverySearches?: number;
  maxSearches?: number;
  onCheckpoint?: (
    checkpoint: EvernoteTaxonomyCheckpoint,
    progress: EvernoteTaxonomyProgress,
  ) => Promise<void>;
};

function taxonomyEntity(value: unknown): EvernoteTaxonomyEntity | null {
  const row = asRecord(value);
  const named = idAndName(row);
  if (!named) return null;
  return {
    ...named,
    parentId:
      boundedScalar(row.parentId, 500) ??
      boundedScalar(row.parentGuid, 500),
    stack: boundedScalar(row.stack, 1_000),
    spaceId:
      boundedScalar(row.workspaceId, 500) ??
      boundedScalar(row.spaceId, 500),
    access:
      boundedScalar(row.primaryAccess, 64) ??
      boundedScalar(row.access, 64),
    metadata: row,
  };
}

function taxonomyCheckpointEntity(
  value: unknown,
): EvernoteTaxonomyEntity | null {
  const entity = taxonomyEntity(value);
  if (!entity) return null;
  const valueRow = asRecord(value);
  return {
    ...entity,
    metadata: asRecord(valueRow.metadata),
  };
}

function initialTaxonomyCheckpoint(
  value: unknown,
): EvernoteTaxonomyCheckpoint {
  const checkpoint = asRecord(value);
  const stage = checkpoint.stage;
  if (
    checkpoint.version !== 1 ||
    (stage !== "notebooks" &&
      stage !== "tags" &&
      stage !== "spaces" &&
      stage !== "complete")
  ) {
    return {
      version: 1,
      stage: "notebooks",
      startedAt: new Date().toISOString(),
      searchesDone: 0,
      frontier: [""],
      visited: [],
      notebooks: [],
      tags: [],
      spaces: [],
    };
  }
  const strings = (candidate: unknown): string[] =>
    asArray(candidate)
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.slice(0, 12));
  const entities = (candidate: unknown): EvernoteTaxonomyEntity[] =>
    asArray(candidate)
      .map(taxonomyCheckpointEntity)
      .filter(
        (entity): entity is EvernoteTaxonomyEntity => Boolean(entity),
      );
  return {
    version: 1,
    stage,
    startedAt:
      asString(checkpoint.startedAt) ?? new Date().toISOString(),
    searchesDone: Math.max(
      0,
      Math.floor(asNumber(checkpoint.searchesDone) ?? 0),
    ),
    frontier: strings(checkpoint.frontier),
    visited: strings(checkpoint.visited),
    notebooks: entities(checkpoint.notebooks),
    tags: entities(checkpoint.tags),
    spaces: entities(checkpoint.spaces),
  };
}

export function evernoteTaxonomyProgress(
  checkpoint: EvernoteTaxonomyCheckpoint,
): EvernoteTaxonomyProgress {
  const startedAt = Date.parse(checkpoint.startedAt);
  return {
    stage: checkpoint.stage,
    searchesDone: checkpoint.searchesDone,
    prefixesQueued: checkpoint.frontier.length,
    notebooksFound: checkpoint.notebooks.length,
    tagsFound: checkpoint.tags.length,
    spacesFound: checkpoint.spaces.length,
    elapsedMs: Number.isFinite(startedAt)
      ? Math.max(0, Date.now() - startedAt)
      : 0,
  };
}

async function emitTaxonomyCheckpoint(
  checkpoint: EvernoteTaxonomyCheckpoint,
  options: EvernoteTaxonomyOptions,
): Promise<void> {
  await options.onCheckpoint?.(
    checkpoint,
    evernoteTaxonomyProgress(checkpoint),
  );
}

async function enumerateNameSearch(
  client: EvernoteReadOnlyToolCaller,
  tool: "search_notebooks" | "search_tags",
  keys: string[],
  checkpoint: EvernoteTaxonomyCheckpoint,
  collection: "notebooks" | "tags",
  options: EvernoteTaxonomyOptions,
): Promise<void> {
  const cap = 100;
  const entities = new Map(
    checkpoint[collection].map((entity) => [entity.id, entity] as const),
  );
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
  const visited = new Set(checkpoint.visited);
  const maxDepth = 12;
  const maxSearches = Math.min(
    256,
    Math.max(1, Math.floor(options.maxSearches ?? 64)),
  );
  const checkpointEvery = Math.min(
    100,
    Math.max(1, Math.floor(options.checkpointEverySearches ?? 10)),
  );
  while (
    checkpoint.frontier.length > 0 &&
    checkpoint.searchesDone < maxSearches
  ) {
    const query = checkpoint.frontier.shift()!;
    if (visited.has(query)) continue;
    visited.add(query);
    const result = await callReadTool(client, tool, {
      query,
      maxResults: cap,
      sortBy: "name",
    });
    const rows = firstArray(result, keys);
    for (const row of rows) {
      const entity = taxonomyEntity(row);
      if (entity) entities.set(entity.id, entity);
    }
    const total = asNumber(
      result.totalResultCount ?? result.total ?? result.totalCount,
    );
    const saturated = rows.length >= cap || (total != null && total > rows.length);
    if (saturated) {
      if (query.length < maxDepth) {
        for (const char of alphabet) {
          checkpoint.frontier.push(`${query}${char}`);
        }
      }
    }
    checkpoint.searchesDone += 1;
    await pace();
    if (checkpoint.searchesDone % checkpointEvery === 0) {
      checkpoint.visited = [...visited];
      checkpoint[collection] = [...entities.values()];
      await emitTaxonomyCheckpoint(checkpoint, options);
    }
  }
  checkpoint.visited = [...visited];
  checkpoint[collection] = [...entities.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/**
 * Evernote's notebook/tag tools have no cursor and match substrings rather
 * than prefixes. This optional discovery pass is therefore strictly bounded
 * and best-effort; note import resolves missing IDs lazily.
 */
export async function enumerateEvernoteTaxonomy(
  client: EvernoteReadOnlyToolCaller,
  options: EvernoteTaxonomyOptions = {},
): Promise<EvernoteTaxonomy> {
  const checkpoint = initialTaxonomyCheckpoint(options.checkpoint);
  if (checkpoint.stage === "notebooks") {
    await enumerateNameSearch(
      client,
      "search_notebooks",
      ["notebooks", "results", "items"],
      checkpoint,
      "notebooks",
      options,
    );
    checkpoint.stage = "tags";
    checkpoint.frontier = [""];
    checkpoint.visited = [];
    await emitTaxonomyCheckpoint(checkpoint, options);
  }
  if (checkpoint.stage === "tags") {
    await enumerateNameSearch(
      client,
      "search_tags",
      ["tags", "results", "items"],
      checkpoint,
      "tags",
      options,
    );
    checkpoint.stage = "spaces";
    checkpoint.frontier = [];
    checkpoint.visited = [];
    await emitTaxonomyCheckpoint(checkpoint, options);
  }
  if (checkpoint.stage === "spaces") {
    const maxSearches = Math.min(
      256,
      Math.max(1, Math.floor(options.maxSearches ?? 64)),
    );
    if (checkpoint.searchesDone < maxSearches) {
      const spaceResult = await callReadTool(client, "search_spaces", {
        query: "",
        maxResults: 100,
      });
      await pace();
      checkpoint.searchesDone += 1;
      checkpoint.spaces = firstArray(spaceResult, [
        "spaces",
        "results",
        "items",
      ])
        .map(taxonomyEntity)
        .filter(
          (entity): entity is EvernoteTaxonomyEntity => Boolean(entity),
        );
    }
    checkpoint.stage = "complete";
    await emitTaxonomyCheckpoint(checkpoint, options);
  }
  return {
    notebooks: checkpoint.notebooks,
    tags: checkpoint.tags,
    spaces: checkpoint.spaces,
  };
}

export type EvernoteTaxonomyLookupProgress = {
  cached: number;
  fetched: number;
};

function observedTaxonomyEntity(
  id: string,
  name: string | null,
  metadata: JsonRecord,
): EvernoteTaxonomyEntity {
  return {
    id,
    name: name ?? id,
    parentId: null,
    stack: null,
    spaceId: null,
    access: null,
    metadata,
  };
}

async function lookupTaxonomyEntity(
  client: EvernoteReadOnlyToolCaller,
  tool: "search_notebooks" | "search_tags",
  keys: string[],
  id: string,
  hintedName: string | null,
): Promise<EvernoteTaxonomyEntity> {
  const query = hintedName && hintedName !== id ? hintedName : "";
  try {
    const result = await callReadTool(client, tool, {
      query,
      maxResults: 100,
      sortBy: query ? "name" : "updated",
    });
    const entities = firstArray(result, keys)
      .map(taxonomyEntity)
      .filter(
        (entity): entity is EvernoteTaxonomyEntity => Boolean(entity),
      );
    const exact =
      entities.find((entity) => entity.id === id) ??
      (hintedName
        ? entities.find(
            (entity) =>
              entity.name.toLocaleLowerCase() ===
              hintedName.toLocaleLowerCase(),
          )
        : null);
    return (
      exact ??
      observedTaxonomyEntity(id, hintedName, {
        lazyLookupMiss: true,
        query,
      })
    );
  } catch (error) {
    if (isMcpRateLimitError(error)) throw error;
    const retryable = new Error(
      error instanceof Error
        ? error.message
        : `Evernote ${tool} lazy lookup failed`,
      { cause: error },
    ) as Error & { evernoteTaxonomyLookupRetryable: true };
    retryable.evernoteTaxonomyLookupRetryable = true;
    throw retryable;
  } finally {
    await pace();
  }
}

async function resolveNoteTaxonomy(
  client: EvernoteReadOnlyToolCaller,
  raw: JsonRecord,
  notebooks: Map<string, EvernoteTaxonomyEntity>,
  tags: Map<string, EvernoteTaxonomyEntity>,
  progress: EvernoteTaxonomyLookupProgress,
  onResolved?: (taxonomy: EvernoteTaxonomy) => Promise<void>,
): Promise<void> {
  const persistResolved = async (
    kind: "notebook" | "tag",
    entity: EvernoteTaxonomyEntity,
  ) => {
    await onResolved?.({
      notebooks: kind === "notebook" ? [entity] : [],
      tags: kind === "tag" ? [entity] : [],
      spaces: [],
    });
  };
  const notebookRow = asRecord(raw.notebook);
  const notebookId =
    asString(raw.notebookId) ??
    asString(raw.notebookGuid) ??
    asString(notebookRow.id) ??
    asString(notebookRow.guid);
  const notebookName =
    asString(raw.notebookName) ?? asString(notebookRow.name);
  if (notebookId) {
    const existing = notebooks.get(notebookId);
    const existingUnresolved =
      existing?.name === notebookId ||
      existing?.metadata.lazyLookupMiss === true;
    if (
      existing &&
      existingUnresolved &&
      notebookName &&
      notebookName !== notebookId
    ) {
      const entity = observedTaxonomyEntity(notebookId, notebookName, {
        observedOnNote: true,
      });
      notebooks.set(notebookId, entity);
      await persistResolved("notebook", entity);
    } else if (existing) {
      progress.cached += 1;
    } else {
      const lookedUp =
        notebookName && notebookName !== notebookId
          ? observedTaxonomyEntity(notebookId, notebookName, {
              observedOnNote: true,
            })
          : await lookupTaxonomyEntity(
              client,
              "search_notebooks",
              ["notebooks", "results", "items"],
              notebookId,
              notebookName,
            );
      if (!notebookName || notebookName === notebookId) progress.fetched += 1;
      notebooks.set(notebookId, lookedUp);
      await persistResolved("notebook", lookedUp);
    }
  }

  const structured = asRecord(raw.structuredContent);
  const tagRows = [...asArray(raw.tags), ...asArray(structured.tags)];
  const embeddedTags = tagRows
    .map(taxonomyEntity)
    .filter(
      (entity): entity is EvernoteTaxonomyEntity => Boolean(entity),
    );
  const handledTagIds = new Set<string>();
  for (const entity of embeddedTags) {
    handledTagIds.add(entity.id);
    const existing = tags.get(entity.id);
    const existingUnresolved =
      existing?.name === entity.id ||
      existing?.metadata.lazyLookupMiss === true;
    if (existing && existingUnresolved && entity.name !== entity.id) {
      tags.set(entity.id, entity);
      await persistResolved("tag", entity);
    } else if (existing) {
      progress.cached += 1;
      continue;
    }
    tags.set(entity.id, entity);
    await persistResolved("tag", entity);
  }
  const tagIds = [
    ...new Set([
      ...asArray(raw.tagIds)
        .map(asString)
        .filter((id): id is string => Boolean(id)),
      ...embeddedTags.map((entity) => entity.id),
    ]),
  ];
  for (const tagId of tagIds) {
    if (handledTagIds.has(tagId)) continue;
    if (tags.has(tagId)) {
      progress.cached += 1;
      continue;
    }
    const entity = await lookupTaxonomyEntity(
      client,
      "search_tags",
      ["tags", "results", "items"],
      tagId,
      null,
    );
    progress.fetched += 1;
    tags.set(tagId, entity);
    await persistResolved("tag", entity);
  }
}

async function pace(): Promise<void> {
  const delay = paceMs();
  if (delay <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function callPacedReadTool(
  client: EvernoteReadOnlyToolCaller,
  name: string,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  try {
    return await callReadTool(client, name, args);
  } finally {
    await pace();
  }
}

export type EvernoteMcpSyncCheckpoint = {
  startIndex: number;
  expectedTotal: number | null;
  recordsFetched: number;
  recordsSkipped: number;
  recordsFailed: number;
  batchesProcessed: number;
  listingAuthoritative: boolean;
};

export type EvernoteMcpSyncBatch = {
  records: EvernoteRawRecord[];
  seen: Array<{ externalId: string; listingIndex: number }>;
  replayExternalIds: string[];
  errors: string[];
  checkpoint: EvernoteMcpSyncCheckpoint;
  taxonomyLookups: EvernoteTaxonomyLookupProgress;
};

type EvernoteMcpStreamOptions = {
  syncRunId: string;
  checkpoint?: Partial<EvernoteMcpSyncCheckpoint>;
  loadKnownNotes: (
    externalIds: string[],
  ) => Promise<Map<string, EvernoteKnownNote>>;
  processBatch: (batch: EvernoteMcpSyncBatch) => Promise<void>;
  stopAfterOneBatch?: boolean;
  maxBatchesPerInvocation?: number;
  taxonomy?: EvernoteTaxonomy;
  onTaxonomy?: (taxonomy: EvernoteTaxonomy) => Promise<void>;
  taxonomyCheckpoint?: unknown;
  onTaxonomyCheckpoint?: EvernoteTaxonomyOptions["onCheckpoint"];
  taxonomyCheckpointEverySearches?: number;
  taxonomyLookupProgress?: Partial<EvernoteTaxonomyLookupProgress>;
  onTaxonomyEntities?: (taxonomy: EvernoteTaxonomy) => Promise<void>;
  query?: string;
  forceTrashed?: boolean;
  stopAtFirstUnchanged?: boolean;
};

function initialCheckpoint(
  checkpoint?: Partial<EvernoteMcpSyncCheckpoint>,
): EvernoteMcpSyncCheckpoint {
  return {
    startIndex: Math.max(0, Math.floor(checkpoint?.startIndex ?? 0)),
    expectedTotal:
      typeof checkpoint?.expectedTotal === "number" &&
      Number.isFinite(checkpoint.expectedTotal)
        ? Math.max(0, Math.floor(checkpoint.expectedTotal))
        : null,
    recordsFetched: Math.max(0, Math.floor(checkpoint?.recordsFetched ?? 0)),
    recordsSkipped: Math.max(0, Math.floor(checkpoint?.recordsSkipped ?? 0)),
    recordsFailed: Math.max(0, Math.floor(checkpoint?.recordsFailed ?? 0)),
    batchesProcessed: Math.max(
      0,
      Math.floor(checkpoint?.batchesProcessed ?? 0),
    ),
    listingAuthoritative: checkpoint?.listingAuthoritative !== false,
  };
}

/**
 * Page through Evernote without retaining the library listing. Every page is
 * reduced to GUID/update metadata, fetched sequentially, persisted by the
 * caller, and checkpointed before the next page is requested.
 */
export async function streamEvernoteViaMcp(
  client: EvernoteReadOnlyToolCaller,
  options: EvernoteMcpStreamOptions,
): Promise<
  EvernoteMcpSyncCheckpoint & {
    recordsDeferred: number;
    listingComplete: boolean;
    authoritativeListing: boolean;
    taxonomyLookups: EvernoteTaxonomyLookupProgress;
  }
> {
  // Taxonomy is an optional cache, never a prerequisite for listing notes.
  const taxonomy = options.taxonomy ?? {
    notebooks: [],
    tags: [],
    spaces: [],
  };
  const notebooks = new Map(
    taxonomy.notebooks.map((item) => [item.id, item] as const),
  );
  const tags = new Map(
    taxonomy.tags.map((item) => [item.id, item] as const),
  );
  const taxonomyLookups = {
    cached: Math.max(
      0,
      Math.floor(options.taxonomyLookupProgress?.cached ?? 0),
    ),
    fetched: Math.max(
      0,
      Math.floor(options.taxonomyLookupProgress?.fetched ?? 0),
    ),
  };

  let checkpoint = initialCheckpoint(options.checkpoint);
  let listingComplete =
    checkpoint.expectedTotal != null &&
    checkpoint.startIndex >= checkpoint.expectedTotal;
  let invocationBatches = 0;
  let reachedIncrementalBoundary = false;
  const pageSize = evernoteMcpBackfillChunkSize();

  while (
    checkpoint.expectedTotal == null ||
    checkpoint.startIndex < checkpoint.expectedTotal
  ) {
    const pageStart = checkpoint.startIndex;
    const result = await callReadTool(client, "search_notes", {
      query: options.query ?? "",
      maxResults: pageSize,
      startIndex: pageStart,
      sortBy: "updated",
      ascending: false,
    });
    // Keep the same global pacing before either a body fetch or the next page.
    await pace();
    const rawPage = firstArray(result, ["notes", "results", "items"]);
    const reportedTotal = asNumber(
      result.totalResultCount ?? result.total ?? result.totalNotes,
    );
    if (reportedTotal != null) {
      if (
        checkpoint.expectedTotal != null &&
        checkpoint.expectedTotal !== reportedTotal
      ) {
        // Offset pagination is no longer authoritative after a concurrent
        // library change. Restart from zero and retain the no-delete guard.
        checkpoint = {
          ...checkpoint,
          startIndex: 0,
          expectedTotal: Math.max(0, Math.floor(reportedTotal)),
          listingAuthoritative: false,
        };
        await options.processBatch({
          records: [],
          seen: [],
          replayExternalIds: [],
          errors: [],
          checkpoint,
          taxonomyLookups: { ...taxonomyLookups },
        });
        if (checkpoint.expectedTotal === 0) {
          listingComplete = true;
        }
        break;
      }
      checkpoint = {
        ...checkpoint,
        expectedTotal: Math.max(0, Math.floor(reportedTotal)),
      };
    }

    if (rawPage.length === 0) {
      if (
        checkpoint.expectedTotal != null &&
        pageStart < checkpoint.expectedTotal
      ) {
        throw new Error(
          `Evernote MCP note listing ended early at ${pageStart} of ${checkpoint.expectedTotal}`,
        );
      }
      listingComplete = true;
      break;
    }

    // A non-conforming server must not defeat the configured memory bound.
    const page = rawPage.slice(0, pageSize);
    if (rawPage.length > pageSize) {
      checkpoint = { ...checkpoint, listingAuthoritative: false };
    }
    const summaries = page.map((raw, offset) => ({
      externalId: noteGuid(raw),
      listingIndex: pageStart + offset,
      updatedAt: iso(noteUpdated(raw)),
    }));
    const ids = summaries
      .map((summary) => summary.externalId)
      .filter((id): id is string => Boolean(id));
    if (ids.length !== summaries.length || new Set(ids).size !== ids.length) {
      checkpoint = { ...checkpoint, listingAuthoritative: false };
    }
    const knownNotes = await options.loadKnownNotes([...new Set(ids)]);
    for (const summary of summaries) {
      const guid = summary.externalId;
      const seen =
        guid == null
          ? []
          : [{ externalId: guid, listingIndex: summary.listingIndex }];
      const records: EvernoteRawRecord[] = [];
      const errors: string[] = [];
      let replayExternalIds: string[] = [];
      let skipped = 0;
      let failed = 0;

      if (!guid) {
        failed = 1;
        errors.push("Evernote MCP note summary is missing a GUID");
        checkpoint = { ...checkpoint, listingAuthoritative: false };
      } else {
        const known = knownNotes.get(guid);
        const processedHere =
          known?.evernoteProcessedSyncRunId === options.syncRunId &&
          known.evernoteProcessedAtIndex === summary.listingIndex;
        const seenHere =
          known?.evernoteSeenSyncRunId === options.syncRunId &&
          known.evernoteSeenAtIndex === summary.listingIndex;
        if (
          (known?.evernoteSeenSyncRunId === options.syncRunId && !seenHere) ||
          (known?.evernoteProcessedSyncRunId === options.syncRunId &&
            !processedHere)
        ) {
          checkpoint = { ...checkpoint, listingAuthoritative: false };
        }
        if (seenHere && !processedHere) replayExternalIds = [guid];
        if (
          processedHere ||
          (!seenHere &&
            known &&
            summary.updatedAt &&
            known.evernoteUpdated === summary.updatedAt &&
            (known.trashed ?? false) === Boolean(options.forceTrashed))
        ) {
          skipped = 1;
          if (options.stopAtFirstUnchanged && !processedHere) {
            reachedIncrementalBoundary = true;
            checkpoint = { ...checkpoint, listingAuthoritative: false };
          }
        } else {
          try {
            const note = compactNoteForSync(
              await callPacedReadTool(client, "get_note", { noteId: guid }),
            );
            await resolveNoteTaxonomy(
              client,
              note,
              notebooks,
              tags,
              taxonomyLookups,
              options.onTaxonomyEntities,
            );
            const record = noteToRaw(note, notebooks, tags);
            if (options.forceTrashed) record.metadata.trashed = true;
            if (record.externalId !== guid) {
              throw new Error(
                `Evernote MCP get_note returned ${record.externalId} for ${guid}`,
              );
            }
            records.push(record);
          } catch (error) {
            if (
              isMcpRateLimitError(error) ||
              asRecord(error).evernoteTaxonomyLookupRetryable === true
            ) {
              throw error;
            }
            failed = 1;
            errors.push(
              error instanceof Error
                ? error.message.slice(0, 300)
                : `Evernote MCP get_note failed for ${guid}`,
            );
          }
        }
      }

      const nextStart = summary.listingIndex + 1;
      checkpoint = {
        ...checkpoint,
        startIndex: nextStart,
        recordsFetched: Math.max(checkpoint.recordsFetched, nextStart),
        recordsSkipped: checkpoint.recordsSkipped + skipped,
        recordsFailed: checkpoint.recordsFailed + failed,
        batchesProcessed: checkpoint.batchesProcessed + 1,
      };
      await options.processBatch({
        records,
        seen,
        replayExternalIds,
        errors,
        checkpoint,
        taxonomyLookups: { ...taxonomyLookups },
      });
      invocationBatches += 1;

      if (reachedIncrementalBoundary) {
        listingComplete = true;
        break;
      }

      if (
        checkpoint.expectedTotal != null &&
        nextStart >= checkpoint.expectedTotal
      ) {
        listingComplete = true;
        break;
      }
      if (
        checkpoint.expectedTotal == null &&
        nextStart >= pageStart + page.length &&
        page.length < pageSize
      ) {
        listingComplete = true;
        break;
      }
      const maxBatches = options.stopAfterOneBatch
        ? 1
        : Math.max(
            1,
            Math.floor(options.maxBatchesPerInvocation ?? Infinity),
          );
      if (invocationBatches >= maxBatches) break;
    }
    if (listingComplete) break;
    const maxBatches = options.stopAfterOneBatch
      ? 1
      : Math.max(1, Math.floor(options.maxBatchesPerInvocation ?? Infinity));
    if (invocationBatches >= maxBatches) break;
  }

  const recordsDeferred =
    checkpoint.expectedTotal == null
      ? listingComplete
        ? 0
        : 1
      : Math.max(0, checkpoint.expectedTotal - checkpoint.startIndex);
  const authoritativeListing =
    listingComplete &&
    checkpoint.expectedTotal != null &&
    checkpoint.startIndex === checkpoint.expectedTotal &&
    checkpoint.listingAuthoritative;
  return {
    ...checkpoint,
    recordsDeferred,
    listingComplete,
    authoritativeListing,
    taxonomyLookups,
  };
}

export async function fetchEvernoteViaMcp(
  client: EvernoteReadOnlyToolCaller,
  knownNotes: Map<string, EvernoteKnownNote>,
): Promise<EvernoteFetchResult> {
  const records: EvernoteRawRecord[] = [];
  const errors: string[] = [];
  const activeGuids = new Set<string>();
  const result = await streamEvernoteViaMcp(client, {
    syncRunId: "legacy-fetch",
    loadKnownNotes: async (ids) =>
      new Map(
        ids
          .filter((id) => knownNotes.has(id))
          .map((id) => [id, knownNotes.get(id)!] as const),
      ),
    processBatch: async (batch) => {
      records.push(...batch.records);
      errors.push(...batch.errors);
      for (const item of batch.seen) activeGuids.add(item.externalId);
    },
    maxBatchesPerInvocation: evernoteMcpBackfillChunkSize(),
  });
  const deletedExternalIds = result.authoritativeListing
    ? [...knownNotes.keys()].filter((guid) => !activeGuids.has(guid))
    : [];

  return {
    records,
    recordsFetched: result.recordsFetched,
    recordsSkipped: result.recordsSkipped,
    recordsFailed: result.recordsFailed,
    recordsDeferred: result.recordsDeferred,
    deletedExternalIds,
    errors,
  };
}

type EvernoteMcpClientOptions = {
  signal?: AbortSignal;
  deadlineMs?: number;
  fetchFn?: EvernoteMcpFetchImplementation;
  max429Retries?: number;
};

class EvernoteMcpDeadlineError extends Error {
  constructor() {
    super("Evernote MCP connection deadline exceeded");
    this.name = "EvernoteMcpDeadlineError";
  }
}

export async function withEvernoteMcpClient<T>(
  settings: Record<string, unknown>,
  operation: (client: EvernoteReadOnlyToolCaller) => Promise<T>,
  onStateChanged?: (
    settings: EvernoteMcpConnectorSettings,
  ) => Promise<void>,
  options: EvernoteMcpClientOptions = {},
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
  const requestSignal = options.signal;
  const transportFetch: FetchLike = (input, init) =>
    evernoteMcpFetch(
      input,
      {
        ...init,
        signal:
          requestSignal && init?.signal
            ? AbortSignal.any([requestSignal, init.signal])
            : requestSignal ?? init?.signal,
      },
      {
        fetchFn: options.fetchFn,
        maxRetries: options.max429Retries,
      },
    );
  const transport = new StreamableHTTPClientTransport(mcpServerUrl(), {
    authProvider: provider,
    requestInit: requestSignal ? { signal: requestSignal } : undefined,
    fetch: transportFetch,
  });
  const client = new Client({ name: "Recall", version: "1.0.0" });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = (async () => {
      await client.connect(transport);
      const value = await operation(createEvernoteReadOnlyCaller(client));
      return { value, settings: mcpSettingsFromOAuthState(state) };
    })();
    if (options.deadlineMs == null) return await run;
    const timeout = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => {
        reject(new EvernoteMcpDeadlineError());
      }, options.deadlineMs);
    });
    return await Promise.race([run, timeout]);
  } catch (error) {
    const deadlineExpired =
      error instanceof EvernoteMcpDeadlineError ||
      options.signal?.reason instanceof EvernoteMcpDeadlineError;
    if (provider.authorizationUrl && !deadlineExpired) {
      const authorizationError = new UnauthorizedError(
        "Evernote OAuth authorization is required",
      ) as UnauthorizedError & { cause?: unknown };
      authorizationError.cause = error;
      throw authorizationError;
    }
    throw error;
  } finally {
    if (deadline) clearTimeout(deadline);
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

const EVERNOTE_CONNECTION_TEST_TIMEOUT_MS = 15_000;
const EVERNOTE_RECONNECT_MESSAGE =
  "Evernote didn't respond — reconnect Evernote";

function connectionTestError(
  status: 401 | 504,
  cause: unknown,
): Error & { status: number } {
  const error = new Error(EVERNOTE_RECONNECT_MESSAGE, { cause }) as Error & {
    status: number;
  };
  error.status = status;
  return error;
}

function isEvernoteAuthenticationError(error: unknown): boolean {
  if (UnauthorizedError.isInstance(error)) return true;
  const details = asRecord(error);
  const data = asRecord(details.data);
  const status = asNumber(
    details.status ?? details.statusCode ?? data.status ?? data.statusCode,
  );
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    status === 401 ||
    details.code === "invalid_grant" ||
    data.code === "invalid_grant" ||
    /\binvalid_grant\b|\bunauthorized\b|oauth authorization is required/i.test(
      message,
    )
  );
}

type EvernoteConnectionTestOptions = {
  timeoutMs?: number;
  fetchFn?: EvernoteMcpFetchImplementation;
};

export async function testEvernoteMcpConnection(
  settings: Record<string, unknown>,
  onStateChanged?: (
    settings: EvernoteMcpConnectorSettings,
  ) => Promise<void>,
  options: EvernoteConnectionTestOptions = {},
): Promise<{
  notebookCount: number;
  tagCount: null;
  settings: EvernoteMcpConnectorSettings;
}> {
  const controller = new AbortController();
  const timeoutMs = Math.max(
    1,
    Math.min(
      Math.floor(
        options.timeoutMs ?? EVERNOTE_CONNECTION_TEST_TIMEOUT_MS,
      ),
      EVERNOTE_CONNECTION_TEST_TIMEOUT_MS,
    ),
  );
  const abortTimer = setTimeout(() => {
    controller.abort(new EvernoteMcpDeadlineError());
  }, timeoutMs);
  try {
    const result = await withEvernoteMcpClient(settings, async (client) => {
      const probe = parseToolResult(
        asRecord(
          await invokeTool(client, {
            name: "search_notebooks",
            arguments: { query: "", maxResults: 1 },
          }),
        ),
        "search_notebooks",
      );
      const notebookCount = firstArray(
        probe,
        ["notebooks", "results", "items"],
      ).length;
      return { notebookCount, tagCount: null };
    }, onStateChanged, {
      signal: controller.signal,
      deadlineMs: timeoutMs,
      fetchFn: options.fetchFn,
      max429Retries: 0,
    });
    return { ...result.value, settings: result.settings };
  } catch (error) {
    if (
      error instanceof EvernoteMcpDeadlineError ||
      controller.signal.reason instanceof EvernoteMcpDeadlineError
    ) {
      throw connectionTestError(504, error);
    }
    if (isEvernoteAuthenticationError(error)) {
      throw connectionTestError(401, error);
    }
    throw error;
  } finally {
    clearTimeout(abortTimer);
  }
}
