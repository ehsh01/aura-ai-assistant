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
import { logger } from "../lib/logger";

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
const MCP_TEXT_FIELD = "__recallMcpText";
const MCP_CONTENT_TYPES_FIELD = "__recallMcpContentTypes";

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
  const configured = Number(process.env.EVERNOTE_MCP_MAX_429_RETRIES ?? 2);
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
  return Math.min(3_600_000, Math.max(exponential, retryAfterMs ?? 0) + jitter);
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

function evernoteTransientError(
  error: unknown,
  retryAfterMs: number,
  status = 503,
): Error & {
  status: number;
  retryAfterMs: number;
  evernoteTransient: true;
} {
  const wrapped = new Error("Evernote MCP transient backend response", {
    cause: error,
  }) as Error & {
    status: number;
    retryAfterMs: number;
    evernoteTransient: true;
  };
  wrapped.status = status;
  wrapped.retryAfterMs = retryAfterMs;
  wrapped.evernoteTransient = true;
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
    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    const htmlResponse = contentType.includes("text/html");
    const transientStatus =
      response.status === 429 ||
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504;
    if (!transientStatus && !htmlResponse) return response;
    const retryAfterMs =
      retryAfterHeaderMs(response.headers.get("retry-after")) ?? 1_000;
    const backoffMs = evernoteRateLimitBackoffMs(attempt, retryAfterMs);
    await response.body?.cancel().catch(() => undefined);
    if (attempt >= retries) {
      const error =
        response.status === 429
          ? evernoteRateLimitError(
              new Error(
                `Evernote MCP HTTP 429 after ${attempt + 1} request(s)`,
              ),
              backoffMs,
            )
          : evernoteTransientError(
              new Error("Evernote MCP returned a transient HTTP/HTML response"),
              backoffMs,
              response.status >= 500 ? response.status : 503,
            );
      Object.assign(error, { mcpRetriesExhausted: true });
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

function stripClientSecret(value: StoredOAuthClientInformation): {
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
    metadata: row as Omit<StoredOAuthTokens, "access_token" | "refresh_token">,
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
    throw new Error(
      "Evernote MCP OAuth unexpectedly completed without consent",
    );
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
  onStateChanged?: (settings: EvernoteMcpConnectorSettings) => Promise<void>,
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
  const content = asArray(raw.content).map((part) => asRecord(part));
  const contentTypes = [
    ...new Set(
      content
        .map((part) => asString(part.type))
        .filter((type): type is string => Boolean(type)),
    ),
  ];
  const text = content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("\n");
  if (
    /^\s*(?:<!doctype html|<html\b)/i.test(text) ||
    /^\s*503\b.*backend read error/i.test(text)
  ) {
    const transient = new Error(
      "Evernote MCP transient HTML/backend response",
    ) as Error & { status: number; evernoteTransient: true };
    transient.status = 503;
    transient.evernoteTransient = true;
    throw transient;
  }
  if (raw.isError === true) {
    const structuredError = asRecord(raw.structuredContent);
    const error = new Error(
      text ? text.slice(0, 300) : `Evernote MCP ${name} failed`,
    ) as Error & {
      status?: number;
      retryAfterMs?: number;
      evernoteMcpError: true;
      evernoteToolName: string;
      evernoteNotFound?: true;
    };
    error.evernoteMcpError = true;
    error.evernoteToolName = name;
    const structuredStatus = asNumber(
      structuredError.status ?? structuredError.statusCode,
    );
    if (structuredStatus != null) error.status = structuredStatus;
    if (
      name === "get_note" &&
      (structuredStatus === 404 || /\bnot found\b/i.test(error.message))
    ) {
      error.evernoteNotFound = true;
    }
    if (
      structuredStatus === 429 ||
      /\b429\b|rate.?limit/i.test(error.message)
    ) {
      error.status = 429;
      const retryMs = asNumber(
        structuredError.retryAfterMs ?? structuredError.retry_after_ms,
      );
      const retrySeconds = asNumber(
        structuredError.retryAfter ?? structuredError.retry_after,
      );
      error.retryAfterMs =
        retryMs ?? (retrySeconds != null ? retrySeconds * 1_000 : undefined);
    }
    throw error;
  }
  if (raw.structuredContent !== undefined) {
    return {
      ...asRecord(raw.structuredContent),
      ...(text ? { [MCP_TEXT_FIELD]: text } : {}),
      [MCP_CONTENT_TYPES_FIELD]: contentTypes,
    };
  }
  if (!text) {
    return {
      ...raw,
      [MCP_CONTENT_TYPES_FIELD]: contentTypes,
    };
  }
  try {
    return {
      ...asRecord(JSON.parse(text)),
      [MCP_TEXT_FIELD]: text,
      [MCP_CONTENT_TYPES_FIELD]: contentTypes,
    };
  } catch {
    return {
      text,
      [MCP_TEXT_FIELD]: text,
      [MCP_CONTENT_TYPES_FIELD]: contentTypes,
    };
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
      const raw = asRecord(await invokeTool(client, { name, arguments: args }));
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
      const transientBackend =
        row.evernoteTransient === true ||
        (status != null && [502, 503, 504].includes(status)) ||
        /\b50[234]\b|backend read error|<!doctype html|<html/i.test(message);
      if (!rateLimited && !transientBackend) throw error;
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
        headerDelay ??
        messageDelay ??
        (asNumber(
          row.retryAfter ??
            row.retry_after ??
            data.retryAfter ??
            data.retry_after,
        ) ?? 1) * 1_000;
      const boundedDelay = evernoteRateLimitBackoffMs(
        attempt,
        Math.min(Math.max(retryAfterMs, 0), 3_600_000),
      );
      if (row.mcpRetriesExhausted === true || attempt >= maxRetries) {
        throw rateLimited
          ? evernoteRateLimitError(error, boundedDelay)
          : evernoteTransientError(
              error,
              boundedDelay,
              status != null && status >= 500 ? status : 503,
            );
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

function isMcpTransientError(error: unknown): boolean {
  const row = asRecord(error);
  const data = asRecord(row.data);
  const status = asNumber(
    row.status ?? row.statusCode ?? data.status ?? data.statusCode,
  );
  const message = error instanceof Error ? error.message : "";
  return (
    row.evernoteRateLimited === true ||
    row.evernoteTransient === true ||
    status === 429 ||
    (status != null && [502, 503, 504].includes(status)) ||
    /\b429\b|rate.?limit|\b50[234]\b|backend read error|<!doctype html|<html/i.test(
      message,
    )
  );
}

function isEvernoteNoteNotFoundError(error: unknown): boolean {
  if (isMcpTransientError(error)) return false;
  const row = asRecord(error);
  const data = asRecord(row.data);
  const status = asNumber(
    row.status ?? row.statusCode ?? data.status ?? data.statusCode,
  );
  if (status === 429 || (status != null && status >= 500 && status < 600)) {
    return false;
  }
  const message = error instanceof Error ? error.message : "";
  return (
    row.evernoteMcpError === true &&
    row.evernoteToolName === "get_note" &&
    (row.evernoteNotFound === true ||
      status === 404 ||
      /\bnot found\b/i.test(message))
  );
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
  for (const candidate of [row.id, row.guid, row.noteId, row.noteGuid]) {
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

export type EvernoteNoteListingPage = {
  rows: JsonRecord[];
  totalResultCount: number | null;
  startIndex: number;
  hasMore: boolean | null;
  shape: {
    topLevelKeys: string[];
    dataKeys: string[];
    contentTypes: string[];
  };
};

function recordGraph(value: unknown, maxDepth = 5): JsonRecord[] {
  const output: JsonRecord[] = [];
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (
      !current.value ||
      typeof current.value !== "object" ||
      Array.isArray(current.value) ||
      seen.has(current.value)
    ) {
      continue;
    }
    seen.add(current.value);
    const currentRecord = current.value as JsonRecord;
    output.push(currentRecord);
    if (current.depth >= maxDepth) continue;
    for (const child of Object.values(currentRecord)) {
      if (child && typeof child === "object" && !Array.isArray(child)) {
        queue.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return output;
}

function noteRowsFromStructured(value: unknown): JsonRecord[] {
  const records = recordGraph(value);
  const preferredKeys = ["notes", "results", "items", "noteList", "matches"];
  const noteRows = (candidate: unknown): JsonRecord[] =>
    asArray(candidate)
      .map(asRecord)
      .filter((item) => Boolean(noteGuid(item)));
  for (const record of records) {
    for (const key of preferredKeys) {
      const rows = noteRows(record[key]);
      if (rows.length > 0) return rows;
    }
  }
  for (const record of records) {
    for (const candidate of Object.values(record)) {
      const rows = noteRows(candidate);
      if (rows.length > 0) return rows;
    }
  }
  return [];
}

function mcpTextParts(value: unknown): string[] {
  const records = recordGraph(value);
  const parts: string[] = [];
  for (const record of records) {
    for (const candidate of [record[MCP_TEXT_FIELD], record.text]) {
      if (typeof candidate === "string" && candidate.trim()) {
        parts.push(candidate);
      }
    }
    for (const part of asArray(record.content)) {
      const contentPart = asRecord(part);
      if (contentPart.type === "text" && typeof contentPart.text === "string") {
        parts.push(contentPart.text);
      }
    }
  }
  return [...new Set(parts)];
}

function noteRowsFromText(text: string): JsonRecord[] {
  const guidPattern =
    "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const linePattern = new RegExp(
    `^\\s*\\d+\\.\\s+(${guidPattern})(?:\\s+[—-]\\s+(.+?))?\\s*$`,
    "i",
  );
  const rows: JsonRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(linePattern);
    if (!match) continue;
    rows.push({
      id: match[1],
      guid: match[1],
      title: match[2]?.trim() || "Untitled",
    });
  }
  return rows;
}

function nestedScalar(value: unknown, keys: string[]): unknown {
  for (const record of recordGraph(value)) {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) {
        return record[key];
      }
    }
  }
  return null;
}

/**
 * Parse both MCP structured listings and Evernote's numbered text fallback.
 * Shape metadata deliberately contains keys/types only, never note content.
 */
export function parseEvernoteNoteListingPage(
  value: unknown,
  fallbackStartIndex = 0,
): EvernoteNoteListingPage {
  const root = asRecord(value);
  let rows = noteRowsFromStructured(root);
  const textParts = mcpTextParts(root);
  if (rows.length === 0) {
    for (const textPart of textParts) {
      rows = noteRowsFromText(textPart);
      if (rows.length > 0) break;
    }
  }
  const footerPattern =
    /Showing\s+(\d+)\s+of\s+(\d+)\s+\(startIndex=(\d+)(?:,\s*([^)]+))?\)\.?/i;
  const footer = textParts
    .map((textPart) => textPart.match(footerPattern))
    .find((match): match is RegExpMatchArray => Boolean(match));
  const nestedTotalValue = nestedScalar(root, [
    "totalResultCount",
    "totalResults",
    "totalNotes",
    "totalCount",
    "total",
  ]);
  const nestedTotal =
    nestedTotalValue == null ? null : asNumber(nestedTotalValue);
  const totalResultCount = nestedTotal ?? (footer ? Number(footer[2]) : null);
  const nestedStartValue = nestedScalar(root, [
    "startIndex",
    "start",
    "offset",
  ]);
  const nestedStart =
    nestedStartValue == null ? null : asNumber(nestedStartValue);
  const startIndex = Math.max(
    0,
    Math.floor(
      nestedStart ?? (footer ? Number(footer[3]) : fallbackStartIndex),
    ),
  );
  const explicitHasMore = nestedScalar(root, ["hasMore", "moreAvailable"]);
  const isLastPage = nestedScalar(root, ["isLastPage"]);
  const footerStatus = footer?.[4]?.toLowerCase() ?? "";
  const hasMore =
    typeof explicitHasMore === "boolean"
      ? explicitHasMore
      : typeof isLastPage === "boolean"
        ? !isLastPage
        : footer
          ? /more available/.test(footerStatus) ||
            startIndex + Number(footer[1]) < Number(footer[2])
          : totalResultCount != null
            ? startIndex + rows.length < totalResultCount
            : null;
  const contentTypes = [
    ...new Set([
      ...asArray(root[MCP_CONTENT_TYPES_FIELD])
        .map(asString)
        .filter((type): type is string => Boolean(type)),
      ...asArray(root.content)
        .map((part) => asString(asRecord(part).type))
        .filter((type): type is string => Boolean(type)),
    ]),
  ];
  const safeKeys = (record: JsonRecord): string[] =>
    Object.keys(record)
      .filter(
        (key) => key !== MCP_TEXT_FIELD && key !== MCP_CONTENT_TYPES_FIELD,
      )
      .sort();
  return {
    rows,
    totalResultCount,
    startIndex,
    hasMore,
    shape: {
      topLevelKeys: safeKeys(root),
      dataKeys: safeKeys(asRecord(root.data)),
      contentTypes,
    },
  };
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

function boundedText(
  value: unknown,
  max = EVERNOTE_MAX_NOTE_CONTENT_CHARS,
): {
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
      name: boundedScalar(row.name, 500) ?? boundedScalar(row.label, 500) ?? "",
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
        boundedScalar(row.name, 2_000) ?? boundedScalar(row.fileName, 2_000),
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
  const tasks = [...asArray(raw.tasks), ...asArray(structured.tasks)].map(
    compactTask,
  );
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
    (notebookGuid ? (notebooks.get(notebookGuid)?.name ?? notebookGuid) : null);
  const tagRows = [...asArray(raw.tags), ...asArray(structured.tags)];
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
  const tasks = [...asArray(raw.tasks), ...asArray(structured.tasks)];
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
        raw.trashed === true || raw.inTrash === true || Boolean(raw.deleted),
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
      usn: asNumber(raw.usn ?? raw.version ?? raw.updateSequenceNum) ?? null,
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
            boundedScalar(row.mime, 255) ?? boundedScalar(row.mimeType, 255),
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
        raw.trashed === true || raw.inTrash === true || Boolean(raw.deleted),
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
  const configured = Number(process.env.EVERNOTE_MCP_BACKFILL_CHUNK_SIZE ?? 25);
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
      boundedScalar(row.parentId, 500) ?? boundedScalar(row.parentGuid, 500),
    stack: boundedScalar(row.stack, 1_000),
    spaceId:
      boundedScalar(row.workspaceId, 500) ?? boundedScalar(row.spaceId, 500),
    access:
      boundedScalar(row.primaryAccess, 64) ?? boundedScalar(row.access, 64),
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

function initialTaxonomyCheckpoint(value: unknown): EvernoteTaxonomyCheckpoint {
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
      .filter((entity): entity is EvernoteTaxonomyEntity => Boolean(entity));
  return {
    version: 1,
    stage,
    startedAt: asString(checkpoint.startedAt) ?? new Date().toISOString(),
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
    const saturated =
      rows.length >= cap || (total != null && total > rows.length);
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
        .filter((entity): entity is EvernoteTaxonomyEntity => Boolean(entity));
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
      .filter((entity): entity is EvernoteTaxonomyEntity => Boolean(entity));
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
    if (isMcpTransientError(error)) throw error;
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
  const notebookName = asString(raw.notebookName) ?? asString(notebookRow.name);
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
    .filter((entity): entity is EvernoteTaxonomyEntity => Boolean(entity));
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
  version?: 2;
  notebookCursor?: {
    scopes: EvernoteNotebookScope[];
    scopeIndex: number;
    pendingRanges: EvernoteDateRange[];
    activeRange: EvernoteDateRange | null;
    legacyPrefixEnd: number;
    legacyScanIndex: number;
    legacyRetryIndex: number;
    legacyRetryNotes: EvernoteFailedNote[];
    retryReport: EvernoteRetryReportEntry[];
    skipExistingSourceRecords: boolean;
  };
};

export type EvernoteFailedNote = {
  guid: string;
  title: string;
  error?: string;
};

export type EvernoteRetryReportEntry = EvernoteFailedNote & {
  status: "recovered" | "failed" | "skipped_not_found";
};

export type EvernoteNotebookScope = {
  notebookGuid: string | null;
  notebookName: string;
  expectedTotal: number;
  queryMode?: "notebook" | "global";
};

export type EvernoteDateRange = {
  field: "created" | "updated";
  from: string | null;
  before: string | null;
  expectedTotal: number;
  startIndex: number;
};

export type EvernoteMcpSyncBatch = {
  records: EvernoteRawRecord[];
  seen: Array<{ externalId: string; listingIndex: number }>;
  replayExternalIds: string[];
  errors: string[];
  failedNotes: EvernoteFailedNote[];
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
  partitionByNotebook?: boolean;
};

function parseFailedNotes(value: unknown): EvernoteFailedNote[] {
  return asArray(value)
    .map((candidate) => {
      const item = asRecord(candidate);
      const guid = asString(item.guid);
      if (!guid) return null;
      return {
        guid,
        title: asString(item.title) ?? "Untitled",
        ...(asString(item.error) ? { error: asString(item.error)! } : {}),
      };
    })
    .filter((item): item is EvernoteFailedNote => Boolean(item));
}

function parseRetryReport(value: unknown): EvernoteRetryReportEntry[] {
  return asArray(value)
    .map((candidate) => {
      const item = asRecord(candidate);
      const guid = asString(item.guid);
      const status = item.status;
      if (
        !guid ||
        (status !== "recovered" &&
          status !== "failed" &&
          status !== "skipped_not_found")
      ) {
        return null;
      }
      return {
        guid,
        title: asString(item.title) ?? "Untitled",
        status,
        ...(asString(item.error) ? { error: asString(item.error)! } : {}),
      };
    })
    .filter((item): item is EvernoteRetryReportEntry => Boolean(item));
}

function parseEvernoteDateRange(value: unknown): EvernoteDateRange | null {
  const item = asRecord(value);
  if (item.field !== "created" && item.field !== "updated") return null;
  const expectedTotal = asNumber(item.expectedTotal);
  if (expectedTotal == null) return null;
  return {
    field: item.field,
    from: asString(item.from),
    before: asString(item.before),
    expectedTotal: Math.max(0, Math.floor(expectedTotal)),
    startIndex: Math.max(0, Math.floor(asNumber(item.startIndex) ?? 0)),
  };
}

function evernoteDateSearchValue(value: string): string {
  return value.replaceAll(/[-:]/g, "").replace(".000Z", "").replace(/Z$/, "");
}

function quoteEvernoteSearchValue(value: string): string {
  return `"${value.replaceAll('"', "")}"`;
}

export function evernoteNotebookRangeQuery(
  scope: Pick<EvernoteNotebookScope, "notebookGuid" | "queryMode">,
  range?: Pick<EvernoteDateRange, "field" | "from" | "before"> | null,
  baseQuery = "",
): string {
  return [
    baseQuery.trim(),
    scope.queryMode === "global"
      ? ""
      : scope.notebookGuid
        ? `nbGuid:${quoteEvernoteSearchValue(scope.notebookGuid)}`
        : "-nbGuid:*",
    range?.from ? `${range.field}:${evernoteDateSearchValue(range.from)}` : "",
    range?.before
      ? `-${range.field}:${evernoteDateSearchValue(range.before)}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function dateRangeMidpoint(range: EvernoteDateRange): string | null {
  const lower = range.from
    ? Date.parse(range.from)
    : Date.parse("1900-01-01T00:00:00.000Z");
  const upper = range.before
    ? Date.parse(range.before)
    : Date.parse("2200-01-01T00:00:00.000Z");
  if (
    !Number.isFinite(lower) ||
    !Number.isFinite(upper) ||
    upper - lower <= 1_000
  ) {
    return null;
  }
  const midpoint = Math.floor((lower + upper) / 2 / 1_000) * 1_000;
  if (midpoint <= lower || midpoint >= upper) return null;
  return new Date(midpoint).toISOString();
}

export type EvernoteNotebookListingPage = {
  rows: EvernoteTaxonomyEntity[];
  totalResultCount: number | null;
  startIndex: number;
  hasMore: boolean | null;
  recognized: boolean;
  shape: {
    topLevelKeys: string[];
    dataKeys: string[];
    contentTypes: string[];
    textRows: Array<{ guid: string; name: string }>;
  };
};

export type EvernoteNotebookDiscoveryResult = {
  notebooks: EvernoteTaxonomyEntity[];
  totalResultCount: number;
  totalWasReported: boolean;
  pages: number;
  pageShapes: Array<
    EvernoteNotebookListingPage["shape"] & { query: string }
  >;
};

function notebookRowsFromText(value: string): EvernoteTaxonomyEntity[] {
  const guidPattern =
    "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const guidRegex = new RegExp(guidPattern, "i");
  const rows: EvernoteTaxonomyEntity[] = [];
  for (const line of value.split(/\r?\n/)) {
    const numbered = line.match(/^\s*\d+\.\s+(.+?)\s*$/);
    if (!numbered) continue;
    const guidMatch = numbered[1]!.match(guidRegex);
    if (!guidMatch) continue;
    const id = guidMatch[0];
    const name =
      numbered[1]!
        .replace(id, "")
        .replace(/^[\s—–|:-]+|[\s—–|:-]+$/g, "")
        .trim() || id;
    rows.push({
      id,
      name: name.slice(0, 1_000),
      parentId: null,
      stack: null,
      spaceId: null,
      access: null,
      metadata: { listingShape: "text" },
    });
  }
  return rows;
}

export function parseEvernoteNotebookListingPage(
  value: unknown,
  fallbackStartIndex = 0,
): EvernoteNotebookListingPage {
  const root = asRecord(value);
  const records = recordGraph(root);
  const notebookKeys = ["notebooks", "results", "items", "notebookList"];
  let structuredArrayFound = false;
  let rows: EvernoteTaxonomyEntity[] = [];
  for (const record of records) {
    for (const key of notebookKeys) {
      if (!Array.isArray(record[key])) continue;
      structuredArrayFound = true;
      const parsed = asArray(record[key])
        .map(taxonomyEntity)
        .filter(
          (entity): entity is EvernoteTaxonomyEntity => Boolean(entity),
        );
      if (parsed.length > 0) {
        rows = parsed;
        break;
      }
    }
    if (rows.length > 0) break;
  }
  const textParts = mcpTextParts(root);
  if (rows.length === 0) {
    for (const part of textParts) {
      const parsed = notebookRowsFromText(part);
      if (parsed.length > 0) {
        rows = parsed;
        break;
      }
    }
  }
  const footerPattern =
    /Showing\s+(\d+)\s+of\s+(\d+)\s+\(startIndex=(\d+)(?:,\s*([^)]+))?\)\.?/i;
  const footer = textParts
    .map((part) => part.match(footerPattern))
    .find((match): match is RegExpMatchArray => Boolean(match));
  const totalValue = nestedScalar(root, [
    "totalResultCount",
    "totalResults",
    "totalNotebooks",
    "totalCount",
    "total",
  ]);
  const nestedTotal = totalValue == null ? null : asNumber(totalValue);
  const totalResultCount =
    nestedTotal ?? (footer ? Number(footer[2]) : null);
  const startValue = nestedScalar(root, ["startIndex", "start", "offset"]);
  const nestedStart = startValue == null ? null : asNumber(startValue);
  const startIndex = Math.max(
    0,
    Math.floor(nestedStart ?? (footer ? Number(footer[3]) : fallbackStartIndex)),
  );
  const explicitHasMore = nestedScalar(root, ["hasMore", "moreAvailable"]);
  const isLastPage = nestedScalar(root, ["isLastPage"]);
  const footerStatus = footer?.[4]?.toLowerCase() ?? "";
  const hasMore =
    typeof explicitHasMore === "boolean"
      ? explicitHasMore
      : typeof isLastPage === "boolean"
        ? !isLastPage
        : footer
          ? /more available/.test(footerStatus) ||
            startIndex + Number(footer[1]) < Number(footer[2])
          : totalResultCount != null
            ? startIndex + rows.length < totalResultCount
            : null;
  const safeKeys = (record: JsonRecord): string[] =>
    Object.keys(record)
      .filter(
        (key) =>
          key !== MCP_TEXT_FIELD &&
          key !== MCP_CONTENT_TYPES_FIELD,
      )
      .sort();
  return {
    rows,
    totalResultCount,
    startIndex,
    hasMore,
    recognized: structuredArrayFound || Boolean(footer) || rows.length > 0,
    shape: {
      topLevelKeys: safeKeys(root),
      dataKeys: safeKeys(asRecord(root.data)),
      contentTypes: [
        ...new Set(
          asArray(root[MCP_CONTENT_TYPES_FIELD])
            .map(asString)
            .filter((type): type is string => Boolean(type)),
        ),
      ],
      textRows: rows.slice(0, 3).map((entity) => ({
        guid: `${entity.id.slice(0, 8)}…${entity.id.slice(-4)}`,
        name: entity.name.slice(0, 80),
      })),
    },
  };
}

export async function discoverEvernoteNotebooks(
  client: EvernoteReadOnlyToolCaller,
  cached: EvernoteTaxonomyEntity[] = [],
): Promise<EvernoteNotebookDiscoveryResult> {
  const discovered = new Map<string, EvernoteTaxonomyEntity>();
  const pageShapes: EvernoteNotebookDiscoveryResult["pageShapes"] = [];
  let pages = 0;
  const search = async (query: string): Promise<EvernoteNotebookListingPage> => {
    const result = await callPacedReadTool(client, "search_notebooks", {
      query,
      maxResults: 100,
      sortBy: "name",
    });
    const page = parseEvernoteNotebookListingPage(result, 0);
    pageShapes.push({ query, ...page.shape });
    pages += 1;
    if (!page.recognized) {
      throw new Error(
        `Evernote MCP search_notebooks returned an unrecognized listing format for query ${JSON.stringify(query)}; keys=${page.shape.topLevelKeys.join(",") || "(none)"} dataKeys=${page.shape.dataKeys.join(",") || "(none)"} contentTypes=${page.shape.contentTypes.join(",") || "(none)"}`,
      );
    }
    for (const entity of page.rows) discovered.set(entity.id, entity);
    return page;
  };

  // search_notebooks has no offset/cursor. Its documented ranking puts exact
  // and prefix matches before substring matches, so saturated prefixes can be
  // subdivided without relying on unsupported arguments.
  const root = await search("");
  const totalWasReported = root.totalResultCount != null;
  const expectedTotal = Math.max(
    0,
    Math.floor(root.totalResultCount ?? root.rows.length),
  );
  if (discovered.size < expectedTotal) {
    const commonChars =
      "abcdefghijklmnopqrstuvwxyz0123456789-_.'()[]&/".split("");
    const observedInitials = root.rows
      .concat(cached)
      .map(
        (entity) =>
          [...entity.name.trim().toLocaleLowerCase()][0] ?? "",
      )
      .filter(Boolean);
    const alphabet = [...new Set([...commonChars, ...observedInitials])];
    const frontier = [...alphabet];
    const visited = new Set<string>();
    const maxQueries = 4_096;
    while (
      frontier.length > 0 &&
      discovered.size < expectedTotal &&
      visited.size < maxQueries
    ) {
      const query = frontier.shift()!;
      if (!query || visited.has(query)) continue;
      visited.add(query);
      const page = await search(query);
      const prefixMatches = page.rows.filter((entity) =>
        entity.name.toLocaleLowerCase().startsWith(query),
      );
      if (prefixMatches.length < 100) continue;
      if (query.length >= 24) {
        throw new Error(
          `Evernote notebook prefix ${JSON.stringify(query)} remains capped at 100 results`,
        );
      }
      const nextChars = new Set(alphabet);
      for (const entity of prefixMatches) {
        const next = entity.name
          .toLocaleLowerCase()
          .slice(query.length);
        const nextCharacter = [...next][0];
        if (nextCharacter) nextChars.add(nextCharacter);
      }
      for (const char of nextChars) frontier.push(`${query}${char}`);
    }
  }
  if (discovered.size !== expectedTotal) {
    throw new Error(
      `Evernote notebook listing is incomplete: received ${discovered.size} of ${expectedTotal} after ${pages} query partition(s); search_notebooks exposes no offset cursor`,
    );
  }
  const cachedById = new Map(cached.map((entity) => [entity.id, entity]));
  const notebooks = [...discovered.values()].map((entity) => {
    const cachedEntity = cachedById.get(entity.id);
    if (!cachedEntity) return entity;
    return {
      ...cachedEntity,
      ...entity,
      name:
        entity.name === entity.id && cachedEntity.name !== cachedEntity.id
          ? cachedEntity.name
          : entity.name,
      parentId: entity.parentId ?? cachedEntity.parentId,
      stack: entity.stack ?? cachedEntity.stack,
      spaceId: entity.spaceId ?? cachedEntity.spaceId,
      access: entity.access ?? cachedEntity.access,
      metadata: { ...cachedEntity.metadata, ...entity.metadata },
    };
  }).sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  return {
    notebooks,
    totalResultCount: expectedTotal,
    totalWasReported,
    pages,
    pageShapes,
  };
}

function initialCheckpoint(
  checkpoint?: Partial<EvernoteMcpSyncCheckpoint>,
): EvernoteMcpSyncCheckpoint {
  const notebookCursor =
    checkpoint?.version === 2 &&
    checkpoint.notebookCursor &&
    typeof checkpoint.notebookCursor === "object"
      ? checkpoint.notebookCursor
      : undefined;
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
    ...(notebookCursor
      ? {
          version: 2 as const,
          notebookCursor: {
            scopes: asArray(notebookCursor.scopes)
              .map((value): EvernoteNotebookScope | null => {
                const item = asRecord(value);
                const notebookGuid = asString(item.notebookGuid);
                const notebookName =
                  asString(item.notebookName) ??
                  (notebookGuid ? notebookGuid : "No notebook");
                const expectedTotal = asNumber(item.expectedTotal);
                return expectedTotal == null
                  ? null
                  : {
                      notebookGuid,
                      notebookName,
                      expectedTotal: Math.max(0, Math.floor(expectedTotal)),
                      queryMode:
                        item.queryMode === "global" ? "global" : undefined,
                    };
              })
              .filter((value): value is EvernoteNotebookScope =>
                Boolean(value),
              ),
            scopeIndex: Math.max(
              0,
              Math.floor(asNumber(notebookCursor.scopeIndex) ?? 0),
            ),
            pendingRanges: asArray(notebookCursor.pendingRanges)
              .map(parseEvernoteDateRange)
              .filter((value): value is EvernoteDateRange => Boolean(value)),
            activeRange: parseEvernoteDateRange(notebookCursor.activeRange),
            legacyPrefixEnd: Math.max(
              0,
              Math.floor(asNumber(notebookCursor.legacyPrefixEnd) ?? 0),
            ),
            legacyScanIndex: Math.max(
              0,
              Math.floor(asNumber(notebookCursor.legacyScanIndex) ?? 0),
            ),
            legacyRetryIndex: Math.max(
              0,
              Math.floor(asNumber(notebookCursor.legacyRetryIndex) ?? 0),
            ),
            legacyRetryNotes: parseFailedNotes(notebookCursor.legacyRetryNotes),
            retryReport: parseRetryReport(notebookCursor.retryReport),
            skipExistingSourceRecords:
              notebookCursor.skipExistingSourceRecords === true,
          },
        }
      : {}),
  };
}

export async function fetchEvernoteNoteListingPage(
  client: EvernoteReadOnlyToolCaller,
  input: {
    query?: string;
    maxResults: number;
    startIndex: number;
    sortBy?: "updated" | "created" | "relevance" | "title";
    ascending?: boolean;
  },
): Promise<EvernoteNoteListingPage> {
  const result = await callPacedReadTool(client, "search_notes", {
    query: input.query ?? "",
    maxResults: input.maxResults,
    startIndex: input.startIndex,
    sortBy: input.sortBy ?? "updated",
    ascending: input.ascending ?? false,
  });
  return parseEvernoteNoteListingPage(result, input.startIndex);
}

export async function fetchEvernoteNoteListingPageWithRetry(
  client: EvernoteReadOnlyToolCaller,
  input: {
    query?: string;
    maxResults: number;
    startIndex: number;
    sortBy?: "updated" | "created" | "relevance" | "title";
    ascending?: boolean;
  },
  logContext: Record<string, unknown>,
): Promise<EvernoteNoteListingPage> {
  let page: EvernoteNoteListingPage | null = null;
  for (let listingAttempt = 0; listingAttempt < 2; listingAttempt += 1) {
    page = await fetchEvernoteNoteListingPage(client, input);
    const offsetMatches = page.startIndex === input.startIndex;
    const unexpectedlyEmpty =
      page.rows.length === 0 &&
      (page.hasMore === true ||
        (page.totalResultCount != null &&
          page.totalResultCount > input.startIndex));
    if (offsetMatches && !unexpectedlyEmpty) return page;
    logger.warn(
      {
        ...logContext,
        requestedStartIndex: input.startIndex,
        parsedStartIndex: page.startIndex,
        listingAttempt: listingAttempt + 1,
        rowsParsed: page.rows.length,
        totalResultCount: page.totalResultCount,
        topLevelKeys: page.shape.topLevelKeys,
        dataKeys: page.shape.dataKeys,
        contentTypes: page.shape.contentTypes,
      },
      offsetMatches
        ? "Evernote note listing page parsed empty"
        : "Evernote note listing page offset mismatch",
    );
  }
  if (page && page.startIndex !== input.startIndex) {
    const error = new Error(
      `Evernote MCP note listing offset mismatch: requested ${input.startIndex}, received ${page.startIndex}`,
    ) as Error & {
      status: number;
      retryAfterMs: number;
      evernoteTransient: true;
    };
    error.status = 503;
    error.retryAfterMs = 1_000;
    error.evernoteTransient = true;
    throw error;
  }
  if (
    page &&
    page.rows.length === 0 &&
    (page.hasMore === true ||
      (page.totalResultCount != null &&
        page.totalResultCount > input.startIndex))
  ) {
    throw new Error(
      page.totalResultCount != null
        ? `Evernote MCP note listing ended early at ${input.startIndex} of ${page.totalResultCount}`
        : `Evernote MCP note listing ended early at ${input.startIndex} with more available`,
    );
  }
  return page!;
}

const EVERNOTE_SEARCH_RESULT_CAP = 2_000;

export async function planEvernoteNotebookRanges(
  client: EvernoteReadOnlyToolCaller,
  scope: Pick<EvernoteNotebookScope, "notebookGuid" | "notebookName">,
  baseQuery = "",
): Promise<EvernoteDateRange[]> {
  const count = async (range: EvernoteDateRange): Promise<number> => {
    const page = await fetchEvernoteNoteListingPageWithRetry(
      client,
      {
        query: evernoteNotebookRangeQuery(scope, range, baseQuery),
        maxResults: 1,
        startIndex: 0,
      },
      {
        phase: "range-plan",
        notebookGuid: scope.notebookGuid,
      },
    );
    return Math.max(0, Math.floor(page.totalResultCount ?? page.rows.length));
  };
  const root: EvernoteDateRange = {
    field: "created",
    from: null,
    before: null,
    expectedTotal: 0,
    startIndex: 0,
  };
  root.expectedTotal = await count(root);
  const pending = [root];
  const planned: EvernoteDateRange[] = [];
  while (pending.length > 0) {
    const candidate = pending.shift()!;
    if (candidate.expectedTotal < EVERNOTE_SEARCH_RESULT_CAP) {
      planned.push(candidate);
      continue;
    }
    const midpoint = dateRangeMidpoint(candidate);
    if (!midpoint) {
      throw new Error(
        `Evernote notebook ${scope.notebookName} (${scope.notebookGuid ?? "none"}) has ${EVERNOTE_SEARCH_RESULT_CAP} or more notes at one ${candidate.field} timestamp`,
      );
    }
    const left: EvernoteDateRange = {
      ...candidate,
      before: midpoint,
      expectedTotal: 0,
      startIndex: 0,
    };
    const right: EvernoteDateRange = {
      ...candidate,
      from: midpoint,
      expectedTotal: 0,
      startIndex: 0,
    };
    [left.expectedTotal, right.expectedTotal] = await Promise.all([
      count(left),
      count(right),
    ]);
    if (left.expectedTotal + right.expectedTotal !== candidate.expectedTotal) {
      throw new Error(
        `Evernote notebook changed while planning ranges for ${scope.notebookName}: expected ${candidate.expectedTotal}, split returned ${left.expectedTotal + right.expectedTotal}`,
      );
    }
    pending.unshift(left, right);
  }
  return planned;
}

async function streamEvernoteByNotebook(
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
  const taxonomy = options.taxonomy ?? {
    notebooks: [],
    tags: [],
    spaces: [],
  };
  let checkpoint = initialCheckpoint(options.checkpoint);
  const legacyCheckpoint = checkpoint.version !== 2;
  const resumedScopes = checkpoint.notebookCursor?.scopes ?? [];
  const discoveredNotebooks = legacyCheckpoint
    ? (await discoverEvernoteNotebooks(client, taxonomy.notebooks)).notebooks
    : resumedScopes
        .filter(
          (scope): scope is EvernoteNotebookScope & { notebookGuid: string } =>
            Boolean(scope.notebookGuid),
        )
        .map((scope) => ({
          id: scope.notebookGuid,
          name: scope.notebookName,
          parentId: null,
          stack: null,
          spaceId: null,
          access: null,
          metadata: { restoredFromCheckpoint: true },
        }));
  if (legacyCheckpoint && discoveredNotebooks.length > 0) {
    await options.onTaxonomyEntities?.({
      notebooks: discoveredNotebooks,
      tags: [],
      spaces: [],
    });
  }
  const notebooks = new Map(
    discoveredNotebooks.map((item) => [item.id, item] as const),
  );
  const tags = new Map(taxonomy.tags.map((item) => [item.id, item] as const));
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
  const maxBatches = options.stopAfterOneBatch
    ? 1
    : Math.max(1, Math.floor(options.maxBatchesPerInvocation ?? Infinity));
  let invocationBatches = 0;
  const emit = async (
    batch: Omit<EvernoteMcpSyncBatch, "checkpoint" | "taxonomyLookups">,
  ) => {
    await options.processBatch({
      ...batch,
      checkpoint: structuredClone(checkpoint),
      taxonomyLookups: { ...taxonomyLookups },
    });
    invocationBatches += 1;
  };

  if (legacyCheckpoint) {
    const global = await fetchEvernoteNoteListingPageWithRetry(
      client,
      {
        query: options.query ?? "",
        maxResults: 1,
        startIndex: 0,
      },
      { syncRunId: options.syncRunId, phase: "notebook-plan" },
    );
    const globalTotal = Math.max(
      0,
      Math.floor(global.totalResultCount ?? global.rows.length),
    );
    const scopes: EvernoteNotebookScope[] = [];
    let assigned = 0;
    for (const notebook of discoveredNotebooks) {
      const page = await fetchEvernoteNoteListingPageWithRetry(
        client,
        {
          query: evernoteNotebookRangeQuery(
            { notebookGuid: notebook.id },
            null,
            options.query,
          ),
          maxResults: 1,
          startIndex: 0,
        },
        {
          syncRunId: options.syncRunId,
          phase: "notebook-count",
          notebookGuid: notebook.id,
        },
      );
      const expectedTotal = Math.max(
        0,
        Math.floor(page.totalResultCount ?? page.rows.length),
      );
      assigned += expectedTotal;
      scopes.push({
        notebookGuid: notebook.id,
        notebookName: notebook.name,
        expectedTotal,
      });
    }
    const unassigned = Math.max(0, globalTotal - assigned);
    let noNotebookTotal = 0;
    if (unassigned > 0) {
      const page = await fetchEvernoteNoteListingPageWithRetry(
        client,
        {
          query: evernoteNotebookRangeQuery(
            { notebookGuid: null },
            null,
            options.query,
          ),
          maxResults: 1,
          startIndex: 0,
        },
        {
          syncRunId: options.syncRunId,
          phase: "notebook-count",
          notebookGuid: null,
        },
      );
      const reportedNoNotebook = Math.max(
        0,
        Math.floor(page.totalResultCount ?? page.rows.length),
      );
      noNotebookTotal =
        assigned + reportedNoNotebook <= globalTotal
          ? reportedNoNotebook
          : 0;
      if (noNotebookTotal > 0) {
        scopes.push({
          notebookGuid: null,
          notebookName: "No notebook",
          expectedTotal: noNotebookTotal,
        });
      }
    }
    if (assigned + noNotebookTotal < globalTotal) {
      scopes.push({
        notebookGuid: null,
        notebookName: "Global fallback",
        expectedTotal: globalTotal,
        queryMode: "global",
      });
    }
    const oldStartIndex = checkpoint.startIndex;
    checkpoint = {
      ...checkpoint,
      version: 2,
      startIndex: 0,
      expectedTotal: globalTotal,
      recordsFetched: 0,
      // MCP offset searches do not provide a snapshot token. Never use a
      // partitioned traversal as authority for destructive reconciliation:
      // equal-count concurrent delete/insert changes cannot be detected.
      listingAuthoritative: false,
      notebookCursor: {
        scopes,
        scopeIndex: 0,
        pendingRanges: [],
        activeRange: null,
        legacyPrefixEnd: oldStartIndex,
        legacyScanIndex: 0,
        legacyRetryIndex: 0,
        legacyRetryNotes: [],
        retryReport: [],
        skipExistingSourceRecords: oldStartIndex > 0,
      },
    };
    await emit({
      records: [],
      seen: [],
      replayExternalIds: [],
      errors: [],
      failedNotes: [],
    });
    if (invocationBatches >= maxBatches) {
      return {
        ...checkpoint,
        recordsDeferred: globalTotal,
        listingComplete: false,
        authoritativeListing: false,
        taxonomyLookups,
      };
    }
  }

  const cursor = checkpoint.notebookCursor!;
  if (
    checkpoint.expectedTotal != null &&
    !cursor.scopes.some((scope) => scope.queryMode === "global") &&
    cursor.scopes.reduce((sum, scope) => sum + scope.expectedTotal, 0) <
      checkpoint.expectedTotal
  ) {
    // Upgrade v2 cursors written before global coverage was introduced.
    // Appending preserves the current scope/range cursor; a cursor that had
    // finished its prior scopes naturally points at this new fallback.
    cursor.scopes.push({
      notebookGuid: null,
      notebookName: "Global fallback",
      expectedTotal: checkpoint.expectedTotal,
      queryMode: "global",
    });
  }
  const pageSize = evernoteMcpBackfillChunkSize();

  while (
    cursor.legacyScanIndex < cursor.legacyPrefixEnd &&
    invocationBatches < maxBatches
  ) {
    const requested = Math.min(
      pageSize,
      cursor.legacyPrefixEnd - cursor.legacyScanIndex,
    );
    const page = await fetchEvernoteNoteListingPageWithRetry(
      client,
      {
        query: options.query ?? "",
        maxResults: requested,
        startIndex: cursor.legacyScanIndex,
      },
      { syncRunId: options.syncRunId, phase: "legacy-prefix-scan" },
    );
    if (page.rows.length === 0) {
      throw new Error(
        `Evernote MCP legacy prefix scan ended early at ${cursor.legacyScanIndex} of ${cursor.legacyPrefixEnd}`,
      );
    }
    const listed = page.rows
      .map((item) => ({
        guid: noteGuid(item),
        title: boundedScalar(item.title, 1_000) ?? "Untitled",
      }))
      .filter((item): item is { guid: string; title: string } =>
        Boolean(item.guid),
      );
    const known = await options.loadKnownNotes(listed.map((item) => item.guid));
    const queued = new Set(cursor.legacyRetryNotes.map((item) => item.guid));
    for (const item of listed) {
      const stored = known.get(item.guid);
      const incompleteCurrentRun =
        stored?.evernoteSeenSyncRunId === options.syncRunId &&
        stored.evernoteProcessedSyncRunId !== options.syncRunId;
      if ((!stored || incompleteCurrentRun) && !queued.has(item.guid)) {
        cursor.legacyRetryNotes.push(item);
        queued.add(item.guid);
      }
    }
    cursor.legacyScanIndex += page.rows.length;
    await emit({
      records: [],
      seen: [],
      replayExternalIds: [],
      errors: [],
      failedNotes: [],
    });
  }

  const fetchFullNote = async (guid: string): Promise<EvernoteRawRecord> => {
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
    return record;
  };

  while (
    cursor.legacyScanIndex >= cursor.legacyPrefixEnd &&
    cursor.legacyRetryIndex < cursor.legacyRetryNotes.length &&
    invocationBatches < maxBatches
  ) {
    const retry = cursor.legacyRetryNotes[cursor.legacyRetryIndex]!;
    const listingIndex = checkpoint.startIndex;
    try {
      const record = await fetchFullNote(retry.guid);
      cursor.retryReport.push({ ...retry, status: "recovered" });
      checkpoint.recordsFailed = Math.max(0, checkpoint.recordsFailed - 1);
      cursor.legacyRetryIndex += 1;
      checkpoint.batchesProcessed += 1;
      await emit({
        records: [record],
        seen: [{ externalId: retry.guid, listingIndex }],
        replayExternalIds: [retry.guid],
        errors: [],
        failedNotes: [],
      });
    } catch (error) {
      if (isEvernoteNoteNotFoundError(error)) {
        logger.warn(
          { guid: retry.guid, title: retry.title },
          "Evernote note not found; skipping",
        );
        cursor.retryReport.push({
          ...retry,
          status: "skipped_not_found",
        });
        checkpoint.recordsFailed = Math.max(0, checkpoint.recordsFailed - 1);
        checkpoint.recordsSkipped += 1;
        cursor.legacyRetryIndex += 1;
        checkpoint.batchesProcessed += 1;
        await emit({
          records: [],
          seen: [],
          replayExternalIds: [],
          errors: [],
          failedNotes: [],
        });
        continue;
      }
      if (isMcpTransientError(error)) throw error;
      const message =
        error instanceof Error
          ? error.message.slice(0, 300)
          : "get_note failed";
      cursor.retryReport.push({
        ...retry,
        status: "failed",
        error: message,
      });
      cursor.legacyRetryIndex += 1;
      checkpoint.batchesProcessed += 1;
      await emit({
        records: [],
        seen: [],
        replayExternalIds: [],
        errors: [`${retry.title} (${retry.guid}): ${message}`],
        failedNotes: [{ ...retry, error: message }],
      });
    }
  }

  while (
    cursor.legacyScanIndex >= cursor.legacyPrefixEnd &&
    cursor.legacyRetryIndex >= cursor.legacyRetryNotes.length &&
    cursor.scopeIndex < cursor.scopes.length &&
    invocationBatches < maxBatches
  ) {
    const scope = cursor.scopes[cursor.scopeIndex]!;
    if (!cursor.activeRange && cursor.pendingRanges.length === 0) {
      cursor.pendingRanges.push({
        field: "created",
        from: null,
        before: null,
        expectedTotal: scope.expectedTotal,
        startIndex: 0,
      });
    }
    if (!cursor.activeRange) {
      const candidate = cursor.pendingRanges.shift()!;
      if (candidate.expectedTotal >= EVERNOTE_SEARCH_RESULT_CAP) {
        const midpoint = dateRangeMidpoint(candidate);
        if (!midpoint) {
          throw new Error(
            `Evernote notebook ${scope.notebookName} (${scope.notebookGuid ?? "none"}) has ${EVERNOTE_SEARCH_RESULT_CAP} or more notes at one ${candidate.field} timestamp`,
          );
        }
        const left: EvernoteDateRange = {
          ...candidate,
          before: midpoint,
          startIndex: 0,
        };
        const right: EvernoteDateRange = {
          ...candidate,
          from: midpoint,
          startIndex: 0,
        };
        const leftPage = await fetchEvernoteNoteListingPageWithRetry(
          client,
          {
            query: evernoteNotebookRangeQuery(scope, left, options.query),
            maxResults: 1,
            startIndex: 0,
          },
          {
            syncRunId: options.syncRunId,
            phase: "range-count",
            notebookGuid: scope.notebookGuid,
          },
        );
        const rightPage = await fetchEvernoteNoteListingPageWithRetry(
          client,
          {
            query: evernoteNotebookRangeQuery(scope, right, options.query),
            maxResults: 1,
            startIndex: 0,
          },
          {
            syncRunId: options.syncRunId,
            phase: "range-count",
            notebookGuid: scope.notebookGuid,
          },
        );
        left.expectedTotal = Math.max(
          0,
          Math.floor(leftPage.totalResultCount ?? leftPage.rows.length),
        );
        right.expectedTotal = Math.max(
          0,
          Math.floor(rightPage.totalResultCount ?? rightPage.rows.length),
        );
        if (
          left.expectedTotal + right.expectedTotal !==
          candidate.expectedTotal
        ) {
          checkpoint.listingAuthoritative = false;
        }
        cursor.pendingRanges.unshift(left, right);
        await emit({
          records: [],
          seen: [],
          replayExternalIds: [],
          errors: [],
          failedNotes: [],
        });
        continue;
      }
      cursor.activeRange = candidate;
    }

    const range = cursor.activeRange;
    if (range.expectedTotal === 0 || range.startIndex >= range.expectedTotal) {
      cursor.activeRange = null;
      if (cursor.pendingRanges.length === 0) cursor.scopeIndex += 1;
      continue;
    }
    const pageStart = range.startIndex;
    const listingPage = await fetchEvernoteNoteListingPageWithRetry(
      client,
      {
        query: evernoteNotebookRangeQuery(scope, range, options.query),
        maxResults: pageSize,
        startIndex: pageStart,
        sortBy: "created",
        ascending: true,
      },
      {
        syncRunId: options.syncRunId,
        phase: "notes",
        notebookGuid: scope.notebookGuid,
      },
    );
    if (listingPage.rows.length === 0) {
      throw new Error(
        `Evernote MCP notebook range ended early at ${pageStart} of ${range.expectedTotal} for ${scope.notebookName}`,
      );
    }
    if (
      listingPage.totalResultCount != null &&
      listingPage.totalResultCount !== range.expectedTotal
    ) {
      checkpoint.listingAuthoritative = false;
    }
    const page = listingPage.rows.slice(0, pageSize);
    const summaries = page.map((raw) => ({
      guid: noteGuid(raw),
      title: boundedScalar(raw.title, 1_000) ?? "Untitled",
      updatedAt: iso(noteUpdated(raw)),
    }));
    const ids = summaries
      .map((summary) => summary.guid)
      .filter((guid): guid is string => Boolean(guid));
    const knownNotes = await options.loadKnownNotes([...new Set(ids)]);
    let lastEmittedRangeStart = range.startIndex;

    for (const summary of summaries) {
      if (invocationBatches >= maxBatches) break;
      const known = summary.guid ? knownNotes.get(summary.guid) : undefined;
      const processedHere =
        known?.evernoteProcessedSyncRunId === options.syncRunId;
      if (scope.queryMode === "global" && processedHere) {
        // The global coverage scope is a dedupe backstop. Advance its remote
        // cursor without counting or rewriting GUIDs already covered by a
        // notebook scope; persist trailing duplicate-only progress once/page.
        range.startIndex += 1;
        continue;
      }
      const listingIndex = checkpoint.startIndex;
      const records: EvernoteRawRecord[] = [];
      const seen =
        summary.guid == null
          ? []
          : [{ externalId: summary.guid, listingIndex }];
      const replayExternalIds: string[] = [];
      const errors: string[] = [];
      const failedNotes: EvernoteFailedNote[] = [];
      let skipped = 0;
      let failed = 0;
      if (!summary.guid) {
        failed = 1;
        errors.push("Evernote MCP note summary is missing a GUID");
        checkpoint.listingAuthoritative = false;
      } else {
        const seenHere = known?.evernoteSeenSyncRunId === options.syncRunId;
        if (seenHere && !processedHere) replayExternalIds.push(summary.guid);
        if (
          processedHere ||
          (cursor.skipExistingSourceRecords &&
            Boolean(known) &&
            !(seenHere && !processedHere)) ||
          (!seenHere &&
            known &&
            summary.updatedAt &&
            known.evernoteUpdated === summary.updatedAt &&
            (known.trashed ?? false) === Boolean(options.forceTrashed))
        ) {
          skipped = 1;
        } else {
          try {
            records.push(await fetchFullNote(summary.guid));
          } catch (error) {
            if (isEvernoteNoteNotFoundError(error)) {
              logger.warn(
                { guid: summary.guid, title: summary.title },
                "Evernote note not found; skipping",
              );
              skipped = 1;
            } else {
              if (isMcpTransientError(error)) throw error;
              failed = 1;
              const message =
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : "get_note failed";
              errors.push(`${summary.title} (${summary.guid}): ${message}`);
              failedNotes.push({
                guid: summary.guid,
                title: summary.title,
                error: message,
              });
            }
          }
        }
      }
      range.startIndex += 1;
      checkpoint.startIndex += 1;
      checkpoint.recordsFetched = checkpoint.startIndex;
      checkpoint.recordsSkipped += skipped;
      checkpoint.recordsFailed += failed;
      checkpoint.batchesProcessed += 1;
      await emit({
        records,
        seen,
        replayExternalIds,
        errors,
        failedNotes,
      });
      lastEmittedRangeStart = range.startIndex;
    }
    if (
      range.startIndex > lastEmittedRangeStart &&
      invocationBatches < maxBatches
    ) {
      checkpoint.batchesProcessed += 1;
      await emit({
        records: [],
        seen: [],
        replayExternalIds: [],
        errors: [],
        failedNotes: [],
      });
    }
    if (range.startIndex >= range.expectedTotal) {
      cursor.activeRange = null;
      if (cursor.pendingRanges.length === 0) cursor.scopeIndex += 1;
    }
  }

  const listingComplete =
    cursor.legacyScanIndex >= cursor.legacyPrefixEnd &&
    cursor.legacyRetryIndex >= cursor.legacyRetryNotes.length &&
    cursor.scopeIndex >= cursor.scopes.length;
  const expectedTotal = checkpoint.expectedTotal ?? 0;
  const recordsDeferred = Math.max(0, expectedTotal - checkpoint.startIndex);
  const authoritativeListing =
    listingComplete &&
    checkpoint.startIndex === expectedTotal &&
    checkpoint.listingAuthoritative;
  return {
    ...checkpoint,
    recordsDeferred,
    listingComplete,
    authoritativeListing,
    taxonomyLookups,
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
  if (options.partitionByNotebook) {
    return streamEvernoteByNotebook(client, options);
  }
  // Taxonomy is an optional cache, never a prerequisite for listing notes.
  const taxonomy = options.taxonomy ?? {
    notebooks: [],
    tags: [],
    spaces: [],
  };
  const notebooks = new Map(
    taxonomy.notebooks.map((item) => [item.id, item] as const),
  );
  const tags = new Map(taxonomy.tags.map((item) => [item.id, item] as const));
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
    const listingPage = await fetchEvernoteNoteListingPageWithRetry(
      client,
      {
        query: options.query ?? "",
        maxResults: pageSize,
        startIndex: pageStart,
      },
      { syncRunId: options.syncRunId, phase: "notes" },
    );
    const rawPage = listingPage.rows;
    const reportedTotal = listingPage.totalResultCount;
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
          failedNotes: [],
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
      title: boundedScalar(raw.title, 1_000) ?? "Untitled",
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
      const failedNotes: EvernoteFailedNote[] = [];
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
          known?.evernoteProcessedSyncRunId === options.syncRunId;
        const seenHere = known?.evernoteSeenSyncRunId === options.syncRunId;
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
            if (isEvernoteNoteNotFoundError(error)) {
              logger.warn(
                { guid, title: summary.title },
                "Evernote note not found; skipping",
              );
              skipped = 1;
            } else {
              if (
                isMcpTransientError(error) ||
                asRecord(error).evernoteTaxonomyLookupRetryable === true
              ) {
                throw error;
              }
              failed = 1;
              const message =
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : `Evernote MCP get_note failed for ${guid}`;
              const title = summary.title;
              errors.push(`${title} (${guid}): ${message}`);
              failedNotes.push({ guid, title, error: message });
            }
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
        failedNotes,
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
        : Math.max(1, Math.floor(options.maxBatchesPerInvocation ?? Infinity));
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
  onStateChanged?: (settings: EvernoteMcpConnectorSettings) => Promise<void>,
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
            : (requestSignal ?? init?.signal),
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
  onStateChanged?: (settings: EvernoteMcpConnectorSettings) => Promise<void>,
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
      Math.floor(options.timeoutMs ?? EVERNOTE_CONNECTION_TEST_TIMEOUT_MS),
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
      const notebookCount = parseEvernoteNotebookListingPage(probe, 0).rows
        .length;
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
