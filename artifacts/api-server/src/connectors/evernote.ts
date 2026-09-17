import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { EvidenceInput, NormalizedSourceRecord, RecallConnector } from "./types";

/**
 * Evernote's public Cloud API is the legacy EDAM/Thrift API and uses OAuth 1.0a.
 * The official package supplies the generated Thrift clients. All methods used
 * here are read-only.
 */

type EvernoteConstructor<T = unknown> = new (input?: Record<string, unknown>) => T;

type EvernoteNoteMetadata = {
  guid?: string;
  title?: string;
  created?: number;
  updated?: number;
  deleted?: number;
  updateSequenceNum?: number;
  notebookGuid?: string;
  tagGuids?: string[];
  attributes?: { sourceURL?: string };
  largestResourceMime?: string;
  largestResourceSize?: number;
};

type EvernoteNote = EvernoteNoteMetadata & {
  content?: string;
  active?: boolean;
};

type EvernoteNamedEntity = { guid?: string; name?: string };

export type EvernoteNoteStore = {
  listNotebooks(): Promise<EvernoteNamedEntity[]>;
  listTags(): Promise<EvernoteNamedEntity[]>;
  findNotesMetadata(
    filter: unknown,
    offset: number,
    maxNotes: number,
    spec: unknown,
  ): Promise<{ totalNotes?: number; notes?: EvernoteNoteMetadata[] }>;
  getNote(
    guid: string,
    withContent: boolean,
    withResourcesData: boolean,
    withResourcesRecognition: boolean,
    withResourcesAlternateData: boolean,
  ): Promise<EvernoteNote>;
};

type EvernoteClientInstance = {
  getRequestToken(
    callbackUrl: string,
    callback: (
      error: unknown,
      oauthToken?: string,
      oauthTokenSecret?: string,
    ) => void,
  ): void;
  getAuthorizeUrl(oauthToken: string): string;
  getAccessToken(
    oauthToken: string,
    oauthTokenSecret: string,
    oauthVerifier: string,
    callback: (
      error: unknown,
      accessToken?: string,
      accessTokenSecret?: string,
      results?: Record<string, string>,
    ) => void,
  ): void;
  getUserStore(): {
    getUser(): Promise<{ id?: number; username?: string; name?: string; email?: string }>;
    getUserUrls(): Promise<{
      noteStoreUrl?: string;
      webApiUrlPrefix?: string;
    }>;
  };
  getNoteStore(noteStoreUrl?: string): EvernoteNoteStore;
};

type EvernoteSdk = {
  Client: new (input: Record<string, unknown>) => EvernoteClientInstance;
  NoteStore: {
    NoteFilter: EvernoteConstructor;
    NotesMetadataResultSpec: EvernoteConstructor;
  };
  Types: { NoteSortOrder: { UPDATED: number } };
};

const require = createRequire(import.meta.url);
const Evernote = require("evernote") as EvernoteSdk;

const METADATA_PAGE_SIZE = 250;
const NOTE_FETCH_CONCURRENCY = 4;

export class EvernoteAuthError extends Error {
  status = 401;
  constructor(message = "Evernote authorization failed") {
    super(message);
    this.name = "EvernoteAuthError";
  }
}

export class EvernoteRateLimitError extends Error {
  status = 429;
  constructor(public readonly retryAfterSeconds: number) {
    super(
      `Evernote rate limit reached; retry after ${retryAfterSeconds} second(s)`,
    );
    this.name = "EvernoteRateLimitError";
  }
}

export type EvernoteKnownNote = {
  updateSequenceNum: number | null;
  contentHash: string | null;
  notebookGuid?: string | null;
  notebookName?: string | null;
  tagGuids?: string[];
  tagNames?: string[];
  evernoteUpdated?: string | null;
};

export type EvernoteRawRecord = {
  externalId: string;
  recordType: "evernote_note";
  recordTitle: string;
  recordText: string;
  sourceUrl: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  metadata: Record<string, unknown>;
};

export type EvernoteFetchResult = {
  records: EvernoteRawRecord[];
  recordsFetched: number;
  recordsSkipped: number;
  recordsFailed: number;
  recordsDeferred?: number;
  deletedExternalIds: string[];
  errors: string[];
};

export function isEvernoteSandboxEnabled(): boolean {
  return process.env.EVERNOTE_SANDBOX?.trim().toLowerCase() === "true";
}

function evernoteConfig() {
  const consumerKey = process.env.EVERNOTE_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.EVERNOTE_CONSUMER_SECRET?.trim();
  const callbackUrl =
    process.env.EVERNOTE_EDAM_OAUTH_REDIRECT_URI?.trim() ||
    "https://recall-app.net/api/connectors/evernote/edam/oauth/callback";
  if (!consumerKey || !consumerSecret) {
    const error = new Error(
      "EVERNOTE_CONSUMER_KEY and EVERNOTE_CONSUMER_SECRET are not configured",
    ) as Error & { status?: number };
    error.status = 503;
    throw error;
  }
  return {
    consumerKey,
    consumerSecret,
    callbackUrl,
    sandbox: isEvernoteSandboxEnabled(),
  };
}

function newEvernoteClient(token?: string): EvernoteClientInstance {
  const oauthConfigured = isEvernoteOAuthConfigured();
  const cfg = oauthConfigured
    ? evernoteConfig()
    : {
        consumerKey: undefined,
        consumerSecret: undefined,
        sandbox: isEvernoteSandboxEnabled(),
      };
  if (!token && !oauthConfigured) {
    throw new Error(
      "EVERNOTE_CONSUMER_KEY and EVERNOTE_CONSUMER_SECRET are not configured",
    );
  }
  return new Evernote.Client({
    consumerKey: cfg.consumerKey,
    consumerSecret: cfg.consumerSecret,
    sandbox: cfg.sandbox,
    token,
  });
}

export function isEvernoteOAuthConfigured(): boolean {
  return Boolean(
    process.env.EVERNOTE_CONSUMER_KEY?.trim() &&
      process.env.EVERNOTE_CONSUMER_SECRET?.trim(),
  );
}

export function isEvernoteEdamFallbackConfigured(): boolean {
  return (
    process.env.EVERNOTE_EDAM_FALLBACK_ENABLED?.trim().toLowerCase() ===
      "true" && isEvernoteOAuthConfigured()
  );
}

export function isEvernoteDeveloperTokenConfigured(): boolean {
  return Boolean(process.env.EVERNOTE_DEVELOPER_TOKEN?.trim());
}

export async function inspectEvernoteToken(accessToken: string): Promise<{
  accessToken: string;
  noteStoreUrl: string;
  webApiUrlPrefix: string | null;
  accountId: string;
  accountName: string | null;
  accountEmail: string | null;
  expiresAt: string | null;
}> {
  const client = newEvernoteClient(accessToken);
  const [profile, urls] = await Promise.all([
    client.getUserStore().getUser(),
    client.getUserStore().getUserUrls(),
  ]);
  const accountId = String(profile.id ?? "").trim();
  if (!accountId || !urls.noteStoreUrl) {
    throw new EvernoteAuthError(
      "Evernote developer token did not return an account and NoteStore URL",
    );
  }
  return {
    accessToken,
    noteStoreUrl: urls.noteStoreUrl,
    webApiUrlPrefix: urls.webApiUrlPrefix ?? null,
    accountId,
    accountName: profile.name?.trim() || profile.username?.trim() || null,
    accountEmail: profile.email?.trim().toLowerCase() || null,
    expiresAt: null,
  };
}

export async function beginEvernoteOAuth(state: string): Promise<{
  authorizeUrl: string;
  oauthToken: string;
  oauthTokenSecret: string;
}> {
  const cfg = evernoteConfig();
  const callback = new URL(cfg.callbackUrl);
  callback.searchParams.set("state", state);
  const client = newEvernoteClient();
  const request = await new Promise<{ oauthToken: string; oauthTokenSecret: string }>(
    (resolve, reject) => {
      client.getRequestToken(
        callback.toString(),
        (error, oauthToken, oauthTokenSecret) => {
          if (error || !oauthToken || oauthTokenSecret == null) {
            reject(
              new EvernoteAuthError(
                error instanceof Error
                  ? `Evernote request token failed: ${error.message}`
                  : "Evernote request token failed",
              ),
            );
            return;
          }
          resolve({ oauthToken, oauthTokenSecret });
        },
      );
    },
  );
  return {
    ...request,
    authorizeUrl: client.getAuthorizeUrl(request.oauthToken),
  };
}

export async function exchangeEvernoteOAuth(input: {
  oauthToken: string;
  oauthTokenSecret: string;
  oauthVerifier: string;
}): Promise<{
  accessToken: string;
  noteStoreUrl: string;
  webApiUrlPrefix: string | null;
  accountId: string;
  accountName: string | null;
  accountEmail: string | null;
  expiresAt: string | null;
}> {
  const client = newEvernoteClient();
  const tokenResult = await new Promise<{
    accessToken: string;
    results: Record<string, string>;
  }>((resolve, reject) => {
    client.getAccessToken(
      input.oauthToken,
      input.oauthTokenSecret,
      input.oauthVerifier,
      (error, accessToken, _accessTokenSecret, results) => {
        if (error || !accessToken) {
          reject(
            new EvernoteAuthError(
              error instanceof Error
                ? `Evernote access token failed: ${error.message}`
                : "Evernote access token failed",
            ),
          );
          return;
        }
        resolve({ accessToken, results: results ?? {} });
      },
    );
  });

  const noteStoreUrl = tokenResult.results.edam_noteStoreUrl;
  if (!noteStoreUrl) {
    throw new EvernoteAuthError("Evernote did not return a NoteStore URL");
  }

  const authenticated = newEvernoteClient(tokenResult.accessToken);
  const profile = await authenticated
    .getUserStore()
    .getUser()
    .catch(() => null);
  const resultUserId = tokenResult.results.edam_userId;
  const accountId = String(profile?.id ?? resultUserId ?? "").trim();
  if (!accountId) {
    throw new EvernoteAuthError("Evernote did not return an account identifier");
  }
  const expiresMs = Number(tokenResult.results.edam_expires);

  return {
    accessToken: tokenResult.accessToken,
    noteStoreUrl: decodeURIComponent(noteStoreUrl),
    webApiUrlPrefix: tokenResult.results.edam_webApiUrlPrefix
      ? decodeURIComponent(tokenResult.results.edam_webApiUrlPrefix)
      : null,
    accountId,
    accountName: profile?.name?.trim() || profile?.username?.trim() || null,
    accountEmail: profile?.email?.trim().toLowerCase() || null,
    expiresAt:
      Number.isFinite(expiresMs) && expiresMs > 0
        ? new Date(expiresMs).toISOString()
        : null,
  };
}

function epochMillisToIso(value: number | undefined): string | null {
  if (!value || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function evernoteErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 300);
  if (error && typeof error === "object") {
    const row = error as Record<string, unknown>;
    const message =
      typeof row.message === "string"
        ? row.message
        : typeof row.errorCode === "number"
          ? `Evernote API error ${row.errorCode}`
          : "Evernote API request failed";
    return message.slice(0, 300);
  }
  return "Evernote API request failed";
}

function evernoteRateLimitSeconds(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const row = error as Record<string, unknown>;
  const code = Number(row.errorCode ?? row.code);
  const duration = Number(row.rateLimitDuration ?? row.rate_limit_duration);
  // EDAMErrorCode.RATE_LIMIT_REACHED = 19.
  if (code !== 19 || !Number.isFinite(duration) || duration < 0) return null;
  return duration;
}

export async function withEvernoteRateLimitRetry<T>(
  operation: () => Promise<T>,
  options?: { maxRetries?: number; maxWaitSeconds?: number },
): Promise<T> {
  const maxRetries = Math.min(Math.max(options?.maxRetries ?? 1, 0), 2);
  const maxWaitSeconds = Math.min(
    Math.max(options?.maxWaitSeconds ?? 30, 0),
    60,
  );
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const retryAfter = evernoteRateLimitSeconds(error);
      if (
        retryAfter == null ||
        attempt >= maxRetries ||
        retryAfter > maxWaitSeconds
      ) {
        if (retryAfter != null) {
          throw new EvernoteRateLimitError(retryAfter);
        }
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, retryAfter) * 1_000),
      );
    }
  }
}

export async function testEvernoteReadAccess(
  accessToken: string,
  noteStoreUrl: string,
): Promise<{ notebookCount: number; tagCount: number }> {
  const store = newEvernoteClient(accessToken).getNoteStore(noteStoreUrl);
  const [notebooks, tags] = await Promise.all([
    withEvernoteRateLimitRetry(() => store.listNotebooks()),
    withEvernoteRateLimitRetry(() => store.listTags()),
  ]);
  return { notebookCount: notebooks.length, tagCount: tags.length };
}

function decodeXmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[lower] ?? match;
  });
}

export function evernoteEnmlToText(enml: string): string {
  if (!enml.trim()) return "";
  let html = enml
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  const note = html.match(/<en-note[^>]*>([\s\S]*?)<\/en-note>/i);
  if (note) html = note[1]!;
  html = html
    .replace(/<en-crypt[^>]*>[\s\S]*?<\/en-crypt>/gi, " [encrypted content] ")
    .replace(/<en-todo[^>]*checked=["']true["'][^>]*\/?>/gi, "☑ ")
    .replace(/<en-todo[^>]*\/?>/gi, "☐ ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<en-media[^>]*\/?>/gi, " [attachment] ")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(html)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function evernoteContentHash(input: {
  title: string;
  text: string;
  notebookName: string | null;
  tags: string[];
  sourceUrl: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        title: input.title,
        text: input.text,
        notebookName: input.notebookName,
        tags: [...input.tags].sort(),
        sourceUrl: input.sourceUrl,
      }),
    )
    .digest("hex");
}

function evernoteNoteUrl(
  webApiUrlPrefix: string | null | undefined,
  accountId: string | null | undefined,
  guid: string,
): string | null {
  if (!webApiUrlPrefix || !accountId) return null;
  return `${webApiUrlPrefix.replace(/\/$/, "")}/nl/${encodeURIComponent(accountId)}/${encodeURIComponent(guid)}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
    async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        try {
          results[index] = { status: "fulfilled", value: await fn(items[index]!) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function fetchEvernoteBundle(
  accessToken: string,
  noteStoreUrl: string,
  options?: {
    knownNotes?: Map<string, EvernoteKnownNote>;
    webApiUrlPrefix?: string | null;
    accountId?: string | null;
    /** Test seam; production always builds the official Thrift NoteStore. */
    noteStore?: EvernoteNoteStore;
  },
): Promise<EvernoteFetchResult> {
  const store =
    options?.noteStore ??
    newEvernoteClient(accessToken).getNoteStore(noteStoreUrl);
  const [notebooks, tags] = await Promise.all([
    withEvernoteRateLimitRetry(() => store.listNotebooks()),
    // Do not turn a transient tag failure into GUID-as-name metadata that the
    // next unchanged-USN sync would preserve.
    withEvernoteRateLimitRetry(() => store.listTags()),
  ]);
  const notebooksByGuid = new Map(
    notebooks
      .filter((item) => item.guid)
      .map((item) => [item.guid!, item.name?.trim() || item.guid!] as const),
  );
  const tagsByGuid = new Map(
    tags
      .filter((item) => item.guid)
      .map((item) => [item.guid!, item.name?.trim() || item.guid!] as const),
  );

  const filter = new Evernote.NoteStore.NoteFilter({
    order: Evernote.Types.NoteSortOrder.UPDATED,
    ascending: false,
    inactive: false,
  });
  const spec = new Evernote.NoteStore.NotesMetadataResultSpec({
    includeTitle: true,
    includeCreated: true,
    includeUpdated: true,
    includeDeleted: true,
    includeUpdateSequenceNum: true,
    includeNotebookGuid: true,
    includeTagGuids: true,
    includeAttributes: true,
    includeLargestResourceMime: true,
    includeLargestResourceSize: true,
  });

  const allMetadata: EvernoteNoteMetadata[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const page = await withEvernoteRateLimitRetry(() =>
      store.findNotesMetadata(
        filter,
        offset,
        METADATA_PAGE_SIZE,
        spec,
      ),
    );
    const rows = page.notes ?? [];
    total = page.totalNotes ?? offset + rows.length;
    allMetadata.push(...rows);
    if (rows.length === 0) break;
    offset += rows.length;
  }

  let unchangedBySequence = 0;
  const changedMetadata = allMetadata.filter((metadata) => {
    if (!metadata.guid || metadata.deleted) return false;
    const known = options?.knownNotes?.get(metadata.guid);
    const currentNotebookGuid = metadata.notebookGuid ?? null;
    const currentNotebookName = currentNotebookGuid
      ? notebooksByGuid.get(currentNotebookGuid) ?? currentNotebookGuid
      : null;
    const currentTagGuids = metadata.tagGuids ?? [];
    const currentTagNames = currentTagGuids.map(
      (tagGuid) => tagsByGuid.get(tagGuid) ?? tagGuid,
    );
    const taxonomyUnchanged =
      (known?.notebookGuid ?? null) === currentNotebookGuid &&
      (known?.notebookName ?? null) === currentNotebookName &&
      JSON.stringify([...(known?.tagGuids ?? [])].sort()) ===
        JSON.stringify([...currentTagGuids].sort()) &&
      JSON.stringify([...(known?.tagNames ?? [])].sort()) ===
        JSON.stringify([...currentTagNames].sort());
    if (
      known &&
      known.updateSequenceNum != null &&
      metadata.updateSequenceNum != null &&
      known.updateSequenceNum === metadata.updateSequenceNum &&
      taxonomyUnchanged
    ) {
      unchangedBySequence += 1;
      return false;
    }
    return true;
  });

  const fetched = await mapWithConcurrency(
    changedMetadata,
    NOTE_FETCH_CONCURRENCY,
    async (metadata): Promise<EvernoteRawRecord> => {
      const guid = metadata.guid!;
      // Explicitly omit resource bytes/recognition/alternate data in v1.
      const note = await withEvernoteRateLimitRetry(() =>
        store.getNote(guid, true, false, false, false),
      );
      const title = (note.title ?? metadata.title ?? "Untitled").trim() || "Untitled";
      const text = evernoteEnmlToText(note.content ?? "");
      const notebookGuid = note.notebookGuid ?? metadata.notebookGuid ?? null;
      const notebookName = notebookGuid
        ? notebooksByGuid.get(notebookGuid) ?? notebookGuid
        : null;
      const tagGuids = note.tagGuids ?? metadata.tagGuids ?? [];
      const tagNames = tagGuids.map((tagGuid) => tagsByGuid.get(tagGuid) ?? tagGuid);
      const externalSourceUrl =
        note.attributes?.sourceURL?.trim() ||
        metadata.attributes?.sourceURL?.trim() ||
        null;
      const noteUrl = evernoteNoteUrl(
        options?.webApiUrlPrefix,
        options?.accountId,
        guid,
      );
      const sourceUrl = noteUrl ?? externalSourceUrl;
      const sourceCreatedAt = epochMillisToIso(note.created ?? metadata.created);
      const sourceUpdatedAt = epochMillisToIso(note.updated ?? metadata.updated);
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
          "Evernote note source=evernote_note",
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
            note.updateSequenceNum ?? metadata.updateSequenceNum ?? null,
          notebookGuid,
          notebookName,
          tagGuids,
          tagNames,
          evernoteUpdated: sourceUpdatedAt,
          hasAttachments: Boolean(
            metadata.largestResourceMime ||
              (metadata.largestResourceSize ?? 0) > 0,
          ),
        },
      };
    },
  );

  const exhaustedRateLimit = fetched.find(
    (result) =>
      result.status === "rejected" &&
      result.reason instanceof EvernoteRateLimitError,
  );
  if (exhaustedRateLimit?.status === "rejected") {
    throw exhaustedRateLimit.reason;
  }

  const records = fetched
    .filter(
      (result): result is PromiseFulfilledResult<EvernoteRawRecord> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value);
  const recordsFailed = fetched.length - records.length;
  const errors = fetched
    .filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    .map((result) => evernoteErrorMessage(result.reason));
  const activeGuids = new Set(
    allMetadata
      .filter((metadata) => metadata.guid && !metadata.deleted)
      .map((metadata) => metadata.guid!),
  );
  const deletedExternalIds = options?.knownNotes
    ? [...options.knownNotes.keys()].filter((guid) => !activeGuids.has(guid))
    : [];

  return {
    records,
    recordsFetched: allMetadata.filter((metadata) => !metadata.deleted).length,
    recordsSkipped: unchangedBySequence,
    recordsFailed,
    deletedExternalIds,
    errors,
  };
}

export const evernoteConnector: RecallConnector = {
  id: "evernote",
  type: "evernote",
  sourceOfTruth: "read_only_external",
  async normalize(records: unknown[]): Promise<NormalizedSourceRecord[]> {
    return (records as EvernoteRawRecord[]).map((record) => ({
      externalId: record.externalId,
      recordType: record.recordType,
      recordTitle: record.recordTitle,
      recordText: record.recordText,
      recordMetadata: record.metadata,
      sourceUrl: record.sourceUrl,
      sourceCreatedAt: record.sourceCreatedAt,
      sourceUpdatedAt: record.sourceUpdatedAt,
    }));
  },
  mapEvidence(record: NormalizedSourceRecord): EvidenceInput[] {
    return [
      {
        claimType: "source_excerpt",
        evidenceText: record.recordText?.slice(0, 1_500) ?? record.recordTitle ?? null,
        sourceRecordExternalId: record.externalId,
        url: record.sourceUrl ?? null,
      },
    ];
  },
};
