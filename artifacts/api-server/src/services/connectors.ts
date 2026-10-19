import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  connectors,
  entityEmbeddings,
  evernoteSyncState,
  evidence,
  jobs,
  sourceRecords,
  syncRuns,
  type Connector,
} from "@workspace/db/schema";
import {
  DatabaseAdvisoryLockBusyError,
  getDb,
  withDbAdvisoryLock,
} from "../lib/db";
import { logger } from "../lib/logger";
import {
  newConnectorId,
  newEvidenceId,
  newSourceRecordId,
  newSyncRunId,
} from "../lib/recall-format";
import { csvImportConnector, parseCsvText } from "../connectors/csv-import";
import {
  fetchFinanceTransactions,
  financeApiConnector,
  sumTransactions,
  type FinanceTransaction,
} from "../connectors/finance-api";
import {
  createGoogleCalendarEvent,
  fetchGoogleBundle,
  GoogleNeedsReauthError,
  googleConnector,
  isGoogleNeedsReauthError,
  refreshGoogleAccessToken,
  searchDriveFiles,
  searchGmailMessages,
  type GoogleBundleResult,
  type GoogleSourceResult,
  type GoogleSyncCursor,
} from "../connectors/google";
import {
  fetchHomeyBundle,
  formatHomeyLocalTime,
  generateHomeyWebhookSecret,
  homeyConnector,
  listHomeyDevices,
  listHomeyFlows,
  openHomeyApiSession,
  refreshHomeyAccessToken,
  setHomeyCapabilityValue,
  triggerHomeyFlow,
  isRiskyHomeyCapability,
} from "../connectors/homey";
import {
  fetchMicrosoftBundle,
  microsoftConnector,
  refreshMicrosoftAccessToken,
} from "../connectors/microsoft";
import { manualConnector } from "../connectors/manual";
import {
  fetchTicketEmailsViaImap,
  ticketEmailConnector,
} from "../connectors/ticket-email";
import type { RecallConnector } from "../connectors/types";
import { sanitizeNormalizedSourceRecord } from "../connectors/text-sanitize";
import { upsertEvidenceForSourceRecord } from "./evidence";
import { writeAuditLog } from "./audit";
import {
  evictEntityEmbedding,
  warmEntityEmbedding,
} from "./embedding-cache";
import { heuristicDigest, withSourceDigest } from "./digests";
import { openConnectorSettings, sealConnectorSettings } from "../lib/secret-box";
import { matchHomeyName, type HomeyAskPlan } from "./nl-homey-query";
import type { FlipperForceAskPlan } from "./nl-flipperforce-query";
import {
  fetchFlipperForceActivity,
  fetchFlipperForceAccount,
  fetchFlipperForceBundle,
  fetchFlipperForceProjects,
  fetchProjectFinancials,
  flipperforceConnector,
  formatProjectLine,
  formatUsd,
  matchFlipperForceProject,
  projectAppUrl,
  resolveFlipperForceApiKey,
  testFlipperForceConnection,
  FlipperForceAuthError,
} from "../connectors/flipperforce";
import {
  evernoteConnector,
  fetchEvernoteBundle,
  inspectEvernoteToken,
  testEvernoteReadAccess,
  type EvernoteFetchResult,
  type EvernoteKnownNote,
} from "../connectors/evernote";
import {
  assertEvernoteImportSafe,
  EvernoteWatchdogPauseError,
  evernoteDeferredError,
} from "./evernote-watchdog";
import {
  buildEvernoteCompletenessReport,
  getEvernoteCompletenessReport,
  loadEvernoteTaxonomy,
  persistEvernoteRecordChildren,
  persistEvernoteTaxonomy,
  processEvernoteTaskPage,
  processOneEvernoteAttachment,
  resetInterruptedEvernoteAttachments,
  syncEvernoteReminderFlags,
  verifyOneEvernoteNotebook,
} from "./evernote-full-sync";
import { isEvernoteNightWindow } from "./evernote-runtime-policy";
import {
  databaseErrorCode,
  isSkippableConnectorRecordError,
  safeConnectorErrorMessage,
} from "./connector-record-errors";
import { GOOGLE_SYNC_MAX_CURSOR_RETRIES } from "./job-queue";

const CONNECTOR_IMPLS: Record<string, RecallConnector> = {
  manual: manualConnector,
  csv_import: csvImportConnector,
  finance_api: financeApiConnector,
  google: googleConnector,
  microsoft: microsoftConnector,
  ticket_email: ticketEmailConnector,
  homey: homeyConnector,
  flipperforce: flipperforceConnector,
  evernote: evernoteConnector,
};

export type ConnectorDto = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  baseUrl: string | null;
  authType: string | null;
  enabled: boolean;
  lastSyncAt: string | null;
  syncStatus: string;
  createdAt: string;
  updatedAt: string;
};

function toDto(row: Connector): ConnectorDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description ?? null,
    baseUrl: row.baseUrl ?? null,
    authType: row.authType ?? null,
    enabled: row.enabled,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    syncStatus: row.syncStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listConnectorsForUser(userId: string): Promise<ConnectorDto[]> {
  const rows = await getDb()
    .select()
    .from(connectors)
    .where(eq(connectors.userId, userId))
    .orderBy(desc(connectors.updatedAt));
  return rows.map(toDto);
}

function flipperForceApiKeyFromConnector(conn: Connector): string | null {
  const settings = openConnectorSettings(
    (conn.settings ?? {}) as Record<string, unknown>,
  );
  return resolveFlipperForceApiKey(settings);
}

export async function createConnectorForUser(
  userId: string,
  input: {
    name: string;
    type: string;
    description?: string | null;
    baseUrl?: string | null;
    authType?: string | null;
    settings?: Record<string, unknown>;
  },
): Promise<ConnectorDto> {
  const now = new Date();
  const [row] = await getDb()
    .insert(connectors)
    .values({
      id: newConnectorId(),
      userId,
      name: input.name,
      type: input.type,
      description: input.description ?? null,
      baseUrl: input.baseUrl ?? null,
      authType: input.authType ?? null,
      enabled: true,
      syncStatus: "disconnected",
      settings: sealConnectorSettings(input.settings ?? {}),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toDto(row!);
}

export async function getConnectorForUser(
  userId: string,
  connectorId: string,
): Promise<ConnectorDto | null> {
  const rows = await getDb()
    .select()
    .from(connectors)
    .where(and(eq(connectors.id, connectorId), eq(connectors.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function updateConnectorForUser(
  userId: string,
  connectorId: string,
  input: { enabled?: boolean; name?: string },
): Promise<ConnectorDto | null> {
  const current = await getDb()
    .select()
    .from(connectors)
    .where(
      and(eq(connectors.id, connectorId), eq(connectors.userId, userId)),
    )
    .limit(1);
  if (!current[0]) return null;
  const [updated] = await getDb()
    .update(connectors)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.enabled !== undefined
        ? {
            enabled: input.enabled,
            syncStatus: input.enabled
              ? current[0].syncStatus === "paused"
                ? "connected"
                : current[0].syncStatus
              : "paused",
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(eq(connectors.id, connectorId), eq(connectors.userId, userId)),
    )
    .returning();
  return updated ? toDto(updated) : null;
}

export type SyncRunDto = {
  id: string;
  connectorId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  recordsFetched: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsFailed: number;
  errorMessage: string | null;
  sourceErrors: Record<string, string>;
  metadata: Record<string, unknown>;
};

export async function listConnectorSyncRunsForUser(
  userId: string,
  connectorId: string,
  limit = 25,
): Promise<SyncRunDto[] | null> {
  const connector = await getConnectorForUser(userId, connectorId);
  if (!connector) return null;
  const rows = await getDb()
    .select()
    .from(syncRuns)
    .where(
      and(eq(syncRuns.userId, userId), eq(syncRuns.connectorId, connectorId)),
    )
    .orderBy(desc(syncRuns.startedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((row) => ({
    id: row.id,
    connectorId: row.connectorId,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    recordsFetched: row.recordsFetched,
    recordsCreated: row.recordsCreated,
    recordsUpdated: row.recordsUpdated,
    recordsSkipped: row.recordsSkipped,
    recordsFailed: row.recordsFailed,
    errorMessage: row.errorMessage ?? null,
    sourceErrors: row.sourceErrors ?? {},
    metadata: row.metadata ?? {},
  }));
}

export async function upsertFlipperForceConnectorForUser(
  userId: string,
  apiKey: string,
): Promise<ConnectorDto> {
  const account = await testFlipperForceConnection(apiKey);
  const workspace = account.workspaces[0] ?? null;
  const now = new Date();
  const settings = sealConnectorSettings({
    apiKey,
    email: account.email,
    workspaceUuid: workspace?.uuid ?? null,
    workspaceName: workspace?.name ?? null,
  });

  const existing = await getDb()
    .select()
    .from(connectors)
    .where(and(eq(connectors.userId, userId), eq(connectors.type, "flipperforce")))
    .limit(1);

  if (existing[0]) {
    const [row] = await getDb()
      .update(connectors)
      .set({
        name: "FlipperForce",
        enabled: true,
        syncStatus: "connected",
        authType: "api_key",
        baseUrl: "https://tools.flipperforce.com/api/v1",
        settings,
        updatedAt: now,
      })
      .where(eq(connectors.id, existing[0].id))
      .returning();
    return toDto(row!);
  }

  const [row] = await getDb()
    .insert(connectors)
    .values({
      id: newConnectorId(),
      userId,
      name: "FlipperForce",
      type: "flipperforce",
      description: "Read-only FlipperForce projects, activity, and rehab reports.",
      baseUrl: "https://tools.flipperforce.com/api/v1",
      authType: "api_key",
      enabled: true,
      syncStatus: "connected",
      settings,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toDto(row!);
}

export async function deleteConnectorForUser(
  userId: string,
  connectorId: string,
): Promise<boolean> {
  const deleted = await getDb()
    .delete(connectors)
    .where(and(eq(connectors.id, connectorId), eq(connectors.userId, userId)))
    .returning({ id: connectors.id });
  return Boolean(deleted[0]);
}

export async function testFlipperForceConnectorForUser(
  userId: string,
  connectorId: string,
): Promise<{ ok: boolean; email: string | null; workspaceCount: number }> {
  const rows = await getDb()
    .select()
    .from(connectors)
    .where(and(eq(connectors.id, connectorId), eq(connectors.userId, userId)))
    .limit(1);
  const conn = rows[0];
  if (!conn || conn.type !== "flipperforce") {
    throw new Error("FlipperForce connector not found");
  }
  const apiKey = flipperForceApiKeyFromConnector(conn);
  if (!apiKey) throw new FlipperForceAuthError("No FlipperForce API key stored");
  const account = await testFlipperForceConnection(apiKey);
  await getDb()
    .update(connectors)
    .set({
      syncStatus: "connected",
      updatedAt: new Date(),
      settings: sealConnectorSettings({
        ...openConnectorSettings((conn.settings ?? {}) as Record<string, unknown>),
        email: account.email,
        workspaceUuid: account.workspaces[0]?.uuid ?? null,
        workspaceName: account.workspaces[0]?.name ?? null,
      }),
    })
    .where(eq(connectors.id, conn.id));
  return {
    ok: true,
    email: account.email,
    workspaceCount: account.workspaces.length,
  };
}

async function markGoogleNeedsReauth(
  conn: Connector,
  error: unknown,
): Promise<void> {
  const message =
    error instanceof Error
      ? error.message
      : "Google authorization was revoked — reconnect Google";
  const settings = openConnectorSettings(
    (conn.settings ?? {}) as Record<string, unknown>,
  );
  await getDb()
    .update(connectors)
    .set({
      syncStatus: "needs_reauth",
      settings: sealConnectorSettings({
        ...settings,
        googleAuthError: message.slice(0, 500),
      }),
      updatedAt: new Date(),
    })
    .where(eq(connectors.id, conn.id));
}

/** Resolve a fresh Google access token for a connector row. */
export async function ensureGoogleAccessToken(
  conn: Connector,
  options?: { forceRefresh?: boolean },
): Promise<{
  accessToken: string;
  mailbox: string | null;
}> {
  const settings = openConnectorSettings(
    (conn.settings ?? {}) as Record<string, unknown>,
  );
  if (conn.syncStatus === "needs_reauth") {
    throw new GoogleNeedsReauthError(
      typeof settings.googleAuthError === "string"
        ? settings.googleAuthError
        : "Google authorization was revoked — reconnect Google",
    );
  }
  const refreshToken =
    typeof settings.refreshToken === "string" ? settings.refreshToken : null;
  let accessToken =
    typeof settings.accessToken === "string" ? settings.accessToken : null;
  const expiresAt =
    typeof settings.accessTokenExpiresAt === "string"
      ? Date.parse(settings.accessTokenExpiresAt)
      : 0;
  const mailbox =
    typeof settings.googleEmail === "string"
      ? settings.googleEmail.trim().toLowerCase()
      : null;

  if (!refreshToken && !accessToken) {
    const error = new GoogleNeedsReauthError(
      "Google connector is missing OAuth tokens — reconnect Google",
    );
    await markGoogleNeedsReauth(conn, error);
    throw error;
  }

  const needsRefresh =
    options?.forceRefresh === true ||
    !accessToken ||
    !expiresAt ||
    expiresAt < Date.now() + 60_000;
  if (needsRefresh) {
    if (!refreshToken) {
      const error = new GoogleNeedsReauthError(
        "Google access token expired and no refresh token is stored — reconnect Google",
      );
      await markGoogleNeedsReauth(conn, error);
      throw error;
    }
    let refreshed: Awaited<ReturnType<typeof refreshGoogleAccessToken>>;
    try {
      refreshed = await refreshGoogleAccessToken(refreshToken);
    } catch (error) {
      if (isGoogleNeedsReauthError(error)) {
        await markGoogleNeedsReauth(conn, error);
      }
      throw error;
    }
    accessToken = refreshed.accessToken;
    const nextSettings = sealConnectorSettings({
      ...settings,
      accessToken,
      accessTokenExpiresAt: new Date(
        Date.now() + refreshed.expiresIn * 1000,
      ).toISOString(),
      refreshToken,
      grantedScopes:
        refreshed.scopes.length > 0
          ? refreshed.scopes
          : Array.isArray(settings.grantedScopes)
            ? settings.grantedScopes
            : [],
      googleAuthError: null,
    });
    await getDb()
      .update(connectors)
      .set({ settings: nextSettings, updatedAt: new Date() })
      .where(eq(connectors.id, conn.id));
  }

  return { accessToken: accessToken!, mailbox };
}

/** Resolve a fresh Google access token and fetch the sync bundle. */
async function fetchGoogleRecordsForConnector(
  conn: Connector,
): Promise<unknown[]> {
  const { accessToken, mailbox } = await ensureGoogleAccessToken(conn);
  return (
    await fetchGoogleBundle(accessToken, mailbox, {
      since: conn.lastSyncAt?.toISOString() ?? null,
    })
  ).records;
}

async function ensureMicrosoftAccessToken(conn: Connector): Promise<{
  accessToken: string;
  mailbox: string | null;
}> {
  const settings = openConnectorSettings(
    (conn.settings ?? {}) as Record<string, unknown>,
  );
  const refreshToken =
    typeof settings.refreshToken === "string" ? settings.refreshToken : null;
  let accessToken =
    typeof settings.accessToken === "string" ? settings.accessToken : null;
  const expiresAt =
    typeof settings.accessTokenExpiresAt === "string"
      ? Date.parse(settings.accessTokenExpiresAt)
      : 0;
  const mailbox =
    typeof settings.microsoftEmail === "string"
      ? settings.microsoftEmail.trim().toLowerCase()
      : null;

  if (!refreshToken && !accessToken) {
    throw new Error("Microsoft connector is missing OAuth tokens — reconnect Microsoft");
  }

  const needsRefresh = !accessToken || !expiresAt || expiresAt < Date.now() + 60_000;
  if (needsRefresh) {
    if (!refreshToken) {
      throw new Error(
        "Microsoft access token expired and no refresh token is stored — reconnect Microsoft",
      );
    }
    const refreshed = await refreshMicrosoftAccessToken(refreshToken);
    accessToken = refreshed.accessToken;
    const nextSettings = sealConnectorSettings({
      ...settings,
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
      refreshToken: refreshed.refreshToken ?? refreshToken,
    });
    await getDb()
      .update(connectors)
      .set({ settings: nextSettings, updatedAt: new Date() })
      .where(eq(connectors.id, conn.id));
  }

  return { accessToken: accessToken!, mailbox };
}

async function fetchMicrosoftRecordsForConnector(conn: Connector): Promise<unknown[]> {
  const { accessToken, mailbox } = await ensureMicrosoftAccessToken(conn);
  return fetchMicrosoftBundle(accessToken, mailbox);
}

async function ensureHomeyAccessToken(conn: Connector): Promise<{
  accessToken: string;
  homeyId: string | null;
  remoteUrl: string | null;
  email: string | null;
}> {
  const settings = openConnectorSettings(
    (conn.settings ?? {}) as Record<string, unknown>,
  );
  const refreshToken =
    typeof settings.refreshToken === "string" ? settings.refreshToken : null;
  let accessToken =
    typeof settings.accessToken === "string" ? settings.accessToken : null;
  const expiresAt =
    typeof settings.accessTokenExpiresAt === "string"
      ? Date.parse(settings.accessTokenExpiresAt)
      : 0;
  const homeyId =
    typeof settings.homeyId === "string" ? settings.homeyId : null;
  const remoteUrl =
    typeof settings.remoteUrl === "string" ? settings.remoteUrl : null;
  const email =
    typeof settings.homeyEmail === "string"
      ? settings.homeyEmail.trim().toLowerCase()
      : null;

  if (!refreshToken && !accessToken) {
    throw new Error("Homey connector is missing OAuth tokens — reconnect Homey");
  }

  const needsRefresh = !accessToken || !expiresAt || expiresAt < Date.now() + 60_000;
  if (needsRefresh && refreshToken) {
    const refreshed = await refreshHomeyAccessToken(refreshToken);
    accessToken = refreshed.accessToken;
    const nextSettings = sealConnectorSettings({
      ...settings,
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
      refreshToken: refreshed.refreshToken ?? refreshToken,
    });
    await getDb()
      .update(connectors)
      .set({ settings: nextSettings, updatedAt: new Date() })
      .where(eq(connectors.id, conn.id));
  }

  return { accessToken: accessToken!, homeyId, remoteUrl, email };
}

async function fetchHomeyRecordsForConnector(conn: Connector): Promise<unknown[]> {
  const { accessToken, homeyId, remoteUrl } = await ensureHomeyAccessToken(conn);
  return fetchHomeyBundle(accessToken, { homeyId, remoteUrl });
}

async function openHomeySessionForConnector(conn: Connector) {
  const { accessToken, homeyId, remoteUrl } = await ensureHomeyAccessToken(conn);
  return openHomeyApiSession({ accessToken, homeyId, remoteUrl });
}

/** Live Homey Ask: status read or control / flow trigger. */
export async function executeHomeyAskForUser(
  userId: string,
  plan: HomeyAskPlan,
): Promise<{
  ok: boolean;
  needsConfirmation?: boolean;
  answer: string;
  evidenceText?: string;
}> {
  if (!plan) {
    return { ok: false, answer: "I could not understand that Homey request." };
  }

  const rows = await getDb()
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.userId, userId),
        eq(connectors.type, "homey"),
        eq(connectors.enabled, true),
      ),
    )
    .limit(1);
  const conn = rows[0];
  if (!conn) {
    return {
      ok: false,
      answer:
        "Homey is not connected. Open Connectors and connect Homey Pro first.",
    };
  }

  try {
    const session = await openHomeySessionForConnector(conn);

    if (plan.intent === "status") {
      const devices = await listHomeyDevices(session.baseUrl, session.sessionToken);
      const matched = matchHomeyName(
        plan.deviceHint,
        devices.map((d) => ({ id: d.id, name: d.name })),
      );
      if (!matched) {
        const sample = devices
          .slice(0, 8)
          .map((d) => d.name)
          .join(", ");
        return {
          ok: false,
          answer: sample
            ? `I could not match that device. Connected devices include: ${sample}.`
            : "No Homey devices found. Sync the Homey connector first.",
        };
      }
      const device = devices.find((d) => d.id === matched.id)!;
      const cap =
        plan.capabilityHint && device.capabilities.includes(plan.capabilityHint)
          ? plan.capabilityHint
          : device.capabilities.find((c) =>
              ["alarm_contact", "onoff", "locked", "measure_temperature", "garagedoor_closed"].includes(
                c,
              ),
            ) ?? device.capabilities[0] ?? null;
      const value =
        cap && cap in device.values
          ? device.values[cap]
          : cap
            ? device.values[cap]
            : null;
      const changedIso = cap ? device.lastChanged[cap] : null;
      const changedLine = changedIso
        ? ` last changed ${formatHomeyLocalTime(changedIso)}`
        : "";
      const humanState = describeHomeyCapabilityState(cap, value);
      const stateLine =
        humanState ??
        (cap != null
          ? `${cap}=${JSON.stringify(value ?? device.values[cap] ?? "unknown")}`
          : formatHomeyValues(device.values));
      return {
        ok: true,
        answer: `${device.name}${device.zoneName ? ` (${device.zoneName})` : ""}: ${stateLine}.${changedLine ? `${changedLine}.` : ""}`,
        evidenceText: `Homey device ${device.name} ${cap ?? "state"}=${JSON.stringify(value)}${changedIso ? ` lastChanged=${changedIso}` : ""}`,
      };
    }

    if (plan.intent === "inventory") {
      const devices = await listHomeyDevices(session.baseUrl, session.sessionToken);
      const hint = (plan.classHint ?? plan.nameHint ?? "").toLowerCase();
      const filtered = hint
        ? devices.filter((d) => {
            const hay = `${d.name} ${d.className ?? ""} ${d.zoneName ?? ""}`.toLowerCase();
            if (hint === "door" || hint === "contact") {
              return (
                /\bdoor\b/.test(hay) ||
                (d.capabilities.includes("alarm_contact") && !/\bwindow\b/.test(hay))
              );
            }
            if (hint === "sensor") {
              return (
                /\bsensor\b/.test(hay) ||
                (d.className ?? "").includes("sensor") ||
                d.capabilities.some((c) => c.startsWith("alarm_") || c.startsWith("measure_"))
              );
            }
            if (hint === "light") {
              return (
                /\b(light|lamp|bulb)\b/.test(hay) ||
                d.className === "light" ||
                d.capabilities.includes("onoff")
              );
            }
            if (hint === "lock") {
              return /\block\b/.test(hay) || d.capabilities.includes("locked");
            }
            if (hint === "garage") {
              return /\bgarage\b/.test(hay) || d.capabilities.includes("garagedoor_closed");
            }
            if (hint === "window") {
              return /\bwindow\b/.test(hay);
            }
            return hay.includes(hint);
          })
        : devices;
      if (!filtered.length) {
        return {
          ok: true,
          answer: hint
            ? `I did not find Homey devices matching “${hint}”. Sync Homey on Connectors if this looks wrong.`
            : "No Homey devices returned. Sync the Homey connector first.",
        };
      }
      const lines = filtered
        .slice(0, 25)
        .map((d) => `- ${d.name}${d.zoneName ? ` (${d.zoneName})` : ""}`);
      return {
        ok: true,
        answer: `You have ${filtered.length} Homey device${filtered.length === 1 ? "" : "s"}${
          hint ? ` matching “${hint}”` : ""
        }:\n${lines.join("\n")}${
          filtered.length > 25 ? `\n…and ${filtered.length - 25} more` : ""
        }`,
        evidenceText: `homey inventory count=${filtered.length} hint=${hint || "all"}`,
      };
    }

    if (plan.intent === "flow") {
      const flows = await listHomeyFlows(session.baseUrl, session.sessionToken);
      const matched = matchHomeyName(
        plan.flowHint,
        flows.map((f) => ({ id: f.id, name: f.name })),
      );
      if (!matched) {
        return {
          ok: false,
          answer: "I could not find that Homey Flow. Name the Flow more specifically.",
        };
      }
      if (!plan.confirmed) {
        return {
          ok: true,
          needsConfirmation: true,
          answer: `I can trigger the Homey Flow “${matched.name}”. Reply “confirm” to run it.`,
        };
      }
      await triggerHomeyFlow(session.baseUrl, session.sessionToken, matched.id);
      return {
        ok: true,
        answer: `Triggered Homey Flow “${matched.name}”.`,
        evidenceText: `flow:${matched.id}`,
      };
    }

    // control
    const devices = await listHomeyDevices(session.baseUrl, session.sessionToken);
    const matched = matchHomeyName(
      plan.deviceHint,
      devices.map((d) => ({ id: d.id, name: d.name })),
    );
    if (!matched) {
      return {
        ok: false,
        answer: "I could not match that Homey device. Try the exact device name from Homey.",
      };
    }
    const device = devices.find((d) => d.id === matched.id)!;
    const capability =
      plan.capabilityHint && device.capabilities.includes(plan.capabilityHint)
        ? plan.capabilityHint
        : device.capabilities.includes("onoff")
          ? "onoff"
          : device.capabilities[0] ?? null;
    if (!capability || plan.value === null) {
      return {
        ok: false,
        answer: `I found ${device.name} but could not determine what to change.`,
      };
    }
    const risky =
      plan.risky || isRiskyHomeyCapability(capability) || plan.capabilityHint === "locked";
    if (risky && !plan.confirmed) {
      return {
        ok: true,
        needsConfirmation: true,
        answer: `This would set ${device.name} ${capability}=${JSON.stringify(plan.value)}. Reply “confirm” to proceed.`,
      };
    }
    await setHomeyCapabilityValue(
      session.baseUrl,
      session.sessionToken,
      device.id,
      capability,
      plan.value,
    );
    return {
      ok: true,
      answer: `Updated ${device.name}: set ${capability} to ${JSON.stringify(plan.value)}.`,
      evidenceText: `device:${device.id} ${capability}=${JSON.stringify(plan.value)}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Homey request failed";
    return { ok: false, answer: `Homey request failed: ${message}` };
  }
}

async function loadFlipperForceConnector(userId: string): Promise<Connector | null> {
  const rows = await getDb()
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.userId, userId),
        eq(connectors.type, "flipperforce"),
        eq(connectors.enabled, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Live FlipperForce Ask: projects, activity, rehab P&L (read-only). */
export async function executeFlipperForceAskForUser(
  userId: string,
  plan: FlipperForceAskPlan,
): Promise<{
  ok: boolean;
  answer: string;
  evidenceText?: string;
  sourceUrl?: string | null;
}> {
  if (!plan) {
    return { ok: false, answer: "I could not understand that FlipperForce request." };
  }

  const conn = await loadFlipperForceConnector(userId);
  if (!conn) {
    return {
      ok: false,
      answer:
        "FlipperForce is not connected. Open Connectors, paste your API key from FlipperForce Integrations, and save.",
    };
  }

  const apiKey = flipperForceApiKeyFromConnector(conn);
  if (!apiKey) {
    return {
      ok: false,
      answer: "FlipperForce has no API key stored. Re-save the key on Connectors.",
    };
  }

  try {
    const projects = await fetchFlipperForceProjects(apiKey);

    if (plan.intent === "inventory") {
      if (!projects.length) {
        return {
          ok: true,
          answer: "No FlipperForce projects were returned for this account.",
          evidenceText: "flipperforce project list empty",
        };
      }
      const lines = projects.slice(0, 25).map((p) => `- ${formatProjectLine(p)}`);
      return {
        ok: true,
        answer: `You have ${projects.length} FlipperForce project${projects.length === 1 ? "" : "s"}:\n${lines.join("\n")}${
          projects.length > 25 ? `\n…and ${projects.length - 25} more` : ""
        }`,
        evidenceText: `flipperforce inventory count=${projects.length}`,
      };
    }

    if (plan.intent === "activity") {
      const settings = openConnectorSettings((conn.settings ?? {}) as Record<string, unknown>);
      const account = await fetchFlipperForceAccount(apiKey);
      const workspaceUuid =
        (typeof settings.workspaceUuid === "string" ? settings.workspaceUuid : null) ||
        account.workspaces[0]?.uuid ||
        null;
      if (!workspaceUuid) {
        return {
          ok: false,
          answer: "FlipperForce did not return a workspace, so activity cannot be listed yet.",
        };
      }
      let activity = await fetchFlipperForceActivity(apiKey, workspaceUuid, { perPage: 30 });
      const matched = matchFlipperForceProject(plan.hint, projects);
      if (matched) {
        activity = activity.filter(
          (a) =>
            a.projectUuid === matched.uuid ||
            (a.projectName &&
              a.projectName.toLowerCase().includes(matched.name.toLowerCase())),
        );
      }
      if (!activity.length) {
        return {
          ok: true,
          answer: matched
            ? `No recent FlipperForce activity for ${formatProjectLine(matched)}.`
            : "No recent FlipperForce activity in this workspace.",
          evidenceText: "flipperforce activity empty",
        };
      }
      const lines = activity.slice(0, 12).map((a) => {
        const when = a.performedAt ? a.performedAt.slice(0, 10) : "undated";
        const proj = a.projectName ? ` · ${a.projectName}` : "";
        return `- ${when}${proj}: ${a.message}`;
      });
      return {
        ok: true,
        answer: `Recent FlipperForce activity${matched ? ` for ${matched.name}` : ""}:\n${lines.join("\n")}`,
        evidenceText: `flipperforce activity count=${activity.length}`,
        sourceUrl: matched ? projectAppUrl(matched.uuid) : null,
      };
    }

    const matched = matchFlipperForceProject(plan.hint, projects);
    if (!matched) {
      const sample = projects.slice(0, 8).map((p) => p.name).join(", ");
      return {
        ok: false,
        answer: sample
          ? `I could not match that FlipperForce project. Connected projects include: ${sample}.`
          : "No FlipperForce projects found. Sync the connector first.",
      };
    }

    if (plan.intent === "report") {
      const financials = await fetchProjectFinancials(apiKey, matched);
      return {
        ok: true,
        answer: `${formatProjectLine(matched)}: expenses ${formatUsd(financials.expenses.total)}, income ${formatUsd(financials.income.total)}, net ${formatUsd(financials.net)}. Totals come from FlipperForce (tax included in expense total).`,
        evidenceText: `flipperforce P&L project=${matched.uuid} expenses=${financials.expenses.total} income=${financials.income.total} net=${financials.net}`,
        sourceUrl: projectAppUrl(matched.uuid),
      };
    }

    return {
      ok: true,
      answer: `${formatProjectLine(matched)}. Open in FlipperForce for photos, tasks, and full history.`,
      evidenceText: `flipperforce project ${matched.uuid} ${matched.fullAddress ?? matched.name}`,
      sourceUrl: projectAppUrl(matched.uuid),
    };
  } catch (err) {
    if (err instanceof FlipperForceAuthError) {
      await getDb()
        .update(connectors)
        .set({ syncStatus: "authentication_failed", updatedAt: new Date() })
        .where(eq(connectors.id, conn.id));
      return {
        ok: false,
        answer: "FlipperForce rejected the API key. Paste a new key on Connectors.",
      };
    }
    const message = err instanceof Error ? err.message : "FlipperForce request failed";
    return { ok: false, answer: `FlipperForce request failed: ${message}` };
  }
}

function formatHomeyValues(values: Record<string, unknown>): string {
  const entries = Object.entries(values).slice(0, 8);
  if (!entries.length) return "no live state cached — try Sync on the Homey connector";
  return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
}

function describeHomeyCapabilityState(
  capability: string | null,
  value: unknown,
): string | null {
  if (!capability) return null;
  if (capability === "alarm_contact") {
    if (value === true) return "open (contact alarm true)";
    if (value === false) return "closed (contact alarm false)";
  }
  if (capability === "garagedoor_closed") {
    if (value === true) return "closed";
    if (value === false) return "open";
  }
  if (capability === "locked") {
    if (value === true) return "locked";
    if (value === false) return "unlocked";
  }
  if (capability === "onoff") {
    if (value === true) return "on";
    if (value === false) return "off";
  }
  if (capability === "measure_temperature" && typeof value === "number") {
    return `${value}°`;
  }
  return null;
}

async function fetchTicketEmailRecordsForConnector(conn: Connector): Promise<unknown[]> {
  const settings = openConnectorSettings(
    (conn.settings ?? {}) as Record<string, unknown>,
  );
  const host = typeof settings.host === "string" ? settings.host : "";
  const user = typeof settings.user === "string" ? settings.user : "";
  const password = typeof settings.password === "string" ? settings.password : "";
  const port = typeof settings.port === "number" ? settings.port : Number(settings.port) || 993;
  const secure = settings.secure !== false;
  const mailbox = typeof settings.mailbox === "string" ? settings.mailbox : "INBOX";
  const limit =
    typeof settings.limit === "number" ? settings.limit : Number(settings.limit) || 40;
  return fetchTicketEmailsViaImap({ host, user, password, port, secure, mailbox, limit });
}

async function fetchFlipperForceRecordsForConnector(conn: Connector): Promise<unknown[]> {
  const apiKey = flipperForceApiKeyFromConnector(conn);
  if (!apiKey) throw new FlipperForceAuthError("No FlipperForce API key stored");
  return fetchFlipperForceBundle(apiKey);
}

async function fetchEvernoteRecordsForConnector(
  conn: Connector,
): Promise<EvernoteFetchResult> {
  const settings = openConnectorSettings(
    (conn.settings ?? {}) as Record<string, unknown>,
  );
  const accessToken =
    typeof settings.accessToken === "string" ? settings.accessToken : "";
  const noteStoreUrl =
    typeof settings.noteStoreUrl === "string" ? settings.noteStoreUrl : "";
  const authTransport =
    settings.authTransport === "mcp" ? "mcp" : "edam";
  if (!accessToken || (authTransport === "edam" && !noteStoreUrl)) {
    throw new Error("Evernote connector is missing OAuth credentials — reconnect Evernote");
  }

  if (authTransport === "mcp") {
    const existing = await getDb()
      .select({
        externalId: sourceRecords.externalId,
        metadata: sourceRecords.recordMetadata,
      })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.connectorId, conn.id),
          eq(sourceRecords.recordType, "evernote_note"),
        ),
      );
    const knownNotes = new Map<string, EvernoteKnownNote>();
    for (const row of existing) {
      const usn = row.metadata?.usn ?? row.metadata?.updateSequenceNum;
      const hash = row.metadata?.contentHash;
      knownNotes.set(row.externalId, {
        updateSequenceNum:
          typeof usn === "number" && Number.isFinite(usn) ? usn : null,
        contentHash: typeof hash === "string" ? hash : null,
        evernoteUpdated:
          typeof row.metadata?.evernoteUpdated === "string"
            ? row.metadata.evernoteUpdated
            : null,
        trashed: row.metadata?.trashed === true,
      });
    }
    const { fetchEvernoteViaMcp, withEvernoteMcpClient } = await import(
      "../connectors/evernote-mcp"
    );
    const persistMcpState = async (next: Record<string, unknown>) => {
      await getDb()
        .update(connectors)
        .set({
          settings: sealConnectorSettings({ ...settings, ...next }),
          updatedAt: new Date(),
        })
        .where(eq(connectors.id, conn.id));
    };
    const synced = await withEvernoteMcpClient(
      settings,
      (client) => fetchEvernoteViaMcp(client, knownNotes),
      persistMcpState,
    );
    await getDb()
      .update(connectors)
      .set({
        settings: sealConnectorSettings({
          ...settings,
          ...synced.settings,
        }),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, conn.id));
    return synced.value;
  }

  return fetchEvernoteBundle(accessToken, noteStoreUrl, {
    loadKnownNotes: (externalIds) =>
      loadEvernoteKnownNotes(conn.id, externalIds),
    webApiUrlPrefix:
      typeof settings.webApiUrlPrefix === "string"
        ? settings.webApiUrlPrefix
        : null,
    accountId:
      typeof settings.evernoteAccountId === "string"
        ? settings.evernoteAccountId
        : null,
  });
}

async function removeDeletedEvernoteRecords(
  userId: string,
  connectorId: string,
  externalIds: string[],
): Promise<number> {
  if (externalIds.length === 0) return 0;
  const rows = await getDb()
    .select({ id: sourceRecords.id })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.connectorId, connectorId),
        inArray(sourceRecords.externalId, externalIds),
      ),
    );
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return 0;

  await getDb().transaction(async (tx) => {
    await tx
      .delete(evidence)
      .where(
        and(
          eq(evidence.userId, userId),
          inArray(evidence.sourceRecordId, ids),
        ),
      );
    await tx
      .delete(entityEmbeddings)
      .where(
        and(
          eq(entityEmbeddings.userId, userId),
          eq(entityEmbeddings.entityType, "source_record"),
          inArray(entityEmbeddings.entityId, ids),
        ),
      );
    await tx
      .delete(sourceRecords)
      .where(
        and(
          eq(sourceRecords.userId, userId),
          eq(sourceRecords.connectorId, connectorId),
          inArray(sourceRecords.id, ids),
        ),
      );
  });
  return ids.length;
}

export type LiveGmailHit = {
  mailbox: string;
  title: string;
  text: string;
  externalId: string;
  sourceUrl: string | null;
  sourceCreatedAt: string | null;
};

/** Prefer authuser so multi-account Gmail opens the right mailbox. */
export function gmailOpenUrl(
  sourceUrl: string | null | undefined,
  mailbox: string | null | undefined,
): string | null {
  if (!sourceUrl) return null;
  const idMatch = sourceUrl.match(/#(?:inbox|all|label\/[^/]+)\/([a-zA-Z0-9_-]+)/);
  const messageId = idMatch?.[1];
  if (!messageId) return sourceUrl;
  const account = mailbox?.trim();
  if (account && account.includes("@")) {
    return `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#inbox/${messageId}`;
  }
  return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
}

export type LiveDriveHit = {
  /** Owning connected account (Google email). */
  account: string;
  title: string;
  text: string;
  externalId: string;
  sourceUrl: string | null;
  sourceCreatedAt: string | null;
  mimeType: string | null;
};

/** Per-account Google API budget so one slow account can't stall an Ask. */
const LIVE_SEARCH_TIMEOUT_MS = 6000;
/** Short cache so repeat/follow-up asks return instantly. */
const LIVE_SEARCH_TTL_MS = 60_000;
const liveSearchCache = new Map<string, { at: number; value: unknown }>();

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function liveCacheGet<T>(key: string): T | null {
  const hit = liveSearchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > LIVE_SEARCH_TTL_MS) {
    liveSearchCache.delete(key);
    return null;
  }
  return hit.value as T;
}

function liveCacheSet(key: string, value: unknown): void {
  liveSearchCache.set(key, { at: Date.now(), value });
  if (liveSearchCache.size > 200) {
    const oldest = liveSearchCache.keys().next().value;
    if (oldest) liveSearchCache.delete(oldest);
  }
}

/** Create a Google Calendar event on the user's primary calendar. Read sync is unchanged. */
export async function createCalendarEventForUser(
  userId: string,
  input: { title: string; description?: string | null; start: string; end?: string | null },
): Promise<{ id: string; htmlLink: string | null }> {
  const rows = await loadEnabledGoogleConnectors(userId);
  const conn = rows[0];
  if (!conn) {
    const err = new Error("Connect Google in Connectors before adding calendar events") as Error & {
      status?: number;
    };
    err.status = 400;
    throw err;
  }
  const { accessToken } = await ensureGoogleAccessToken(conn);
  return createGoogleCalendarEvent(accessToken, input);
}

/** All enabled Google connector rows for a user. */
async function loadEnabledGoogleConnectors(userId: string): Promise<Connector[]> {
  return getDb()
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.userId, userId),
        eq(connectors.type, "google"),
        eq(connectors.enabled, true),
      ),
    );
}

function connectorMailbox(row: Connector): string | null {
  const settings = openConnectorSettings(
    (row.settings ?? {}) as Record<string, unknown>,
  );
  return typeof settings.googleEmail === "string"
    ? settings.googleEmail.trim().toLowerCase()
    : null;
}

/** Connected Google account emails (for mailbox-hint matching in Ask). */
export async function getConnectedGoogleMailboxes(userId: string): Promise<string[]> {
  const rows = await loadEnabledGoogleConnectors(userId);
  return rows
    .map((r) => connectorMailbox(r))
    .filter((m): m is string => Boolean(m));
}

/**
 * Live-search Gmail across every connected Google account, in parallel.
 * Used when Ask asks for mail that may not be in the sync cache.
 */
export async function liveSearchGmailForUser(
  userId: string,
  query: string,
  opts?: {
    mailboxHint?: string | null;
    maxPerMailbox?: number;
    /** When set, rank hits so inbound mail matching this person rises first. */
    personName?: string | null;
  },
): Promise<LiveGmailHit[]> {
  const q = query.trim();
  if (!q) return [];

  const hint = opts?.mailboxHint?.trim().toLowerCase() || null;
  const maxPer = opts?.maxPerMailbox ?? 15;
  const cacheKey = `gmail:${userId}:${hint ?? ""}:${maxPer}:${q}`;

  let hits = liveCacheGet<LiveGmailHit[]>(cacheKey);
  if (!hits) {
    const rows = await loadEnabledGoogleConnectors(userId);
    const perAccount = await Promise.all(
      rows.map(async (row): Promise<LiveGmailHit[]> => {
        const mailbox = connectorMailbox(row);
        if (hint && mailbox && mailbox !== hint) return [];
        try {
          const { accessToken } = await ensureGoogleAccessToken(row);
          const found = await withTimeout(
            searchGmailMessages(accessToken, q, maxPer),
            LIVE_SEARCH_TIMEOUT_MS,
            [],
          );
          return found.map((r) => ({
            mailbox: mailbox ?? "unknown",
            title: r.recordTitle,
            text: mailbox ? `Mailbox: ${mailbox}\n${r.recordText}` : r.recordText,
            externalId: r.externalId,
            sourceUrl: gmailOpenUrl(r.sourceUrl, mailbox),
            sourceCreatedAt: r.sourceCreatedAt ?? null,
          }));
        } catch (error) {
          if (isGoogleNeedsReauthError(error)) throw error;
          // Skip mailboxes that fail auth/search; others may still succeed.
          return [];
        }
      }),
    );
    hits = perAccount.flat();
    liveCacheSet(cacheKey, hits);
  }

  if (opts?.personName?.trim()) {
    return rankLiveGmailHitsForPerson(hits, opts.personName);
  }
  return [...hits].sort((a, b) => {
    const ta = a.sourceCreatedAt ? Date.parse(a.sourceCreatedAt) : 0;
    const tb = b.sourceCreatedAt ? Date.parse(b.sourceCreatedAt) : 0;
    return tb - ta;
  });
}

/**
 * Live-search Google Drive across every connected account, in parallel.
 * Uses Drive's native full-text index (searches inside Docs/Sheets/Slides/PDFs
 * and OCR'd scans) so there are no size or scannability limits.
 */
export async function liveSearchDriveForUser(
  userId: string,
  query: string,
  opts?: { mailboxHint?: string | null; maxPerAccount?: number },
): Promise<LiveDriveHit[]> {
  const q = query.trim();
  if (!q) return [];

  const hint = opts?.mailboxHint?.trim().toLowerCase() || null;
  const maxPer = opts?.maxPerAccount ?? 15;
  const cacheKey = `drive:${userId}:${hint ?? ""}:${maxPer}:${q}`;

  const cached = liveCacheGet<LiveDriveHit[]>(cacheKey);
  if (cached) return cached;

  const rows = await loadEnabledGoogleConnectors(userId);
  const perAccount = await Promise.all(
    rows.map(async (row): Promise<LiveDriveHit[]> => {
      const account = connectorMailbox(row);
      if (hint && account && account !== hint) return [];
      try {
        const { accessToken } = await ensureGoogleAccessToken(row);
        const found = await withTimeout(
          searchDriveFiles(accessToken, q, maxPer),
          LIVE_SEARCH_TIMEOUT_MS,
          [],
        );
        return found.map((r) => ({
          account: account ?? "unknown",
          title: r.recordTitle,
          text: account ? `Account: ${account}\n${r.recordText}` : r.recordText,
          externalId: r.externalId,
          sourceUrl: r.sourceUrl ?? null,
          sourceCreatedAt: r.sourceCreatedAt ?? null,
          mimeType:
            typeof r.metadata?.mimeType === "string" ? r.metadata.mimeType : null,
        }));
      } catch (error) {
        if (isGoogleNeedsReauthError(error)) throw error;
        return [];
      }
    }),
  );

  const hits = perAccount.flat().sort((a, b) => {
    const ta = a.sourceCreatedAt ? Date.parse(a.sourceCreatedAt) : 0;
    const tb = b.sourceCreatedAt ? Date.parse(b.sourceCreatedAt) : 0;
    return tb - ta;
  });
  liveCacheSet(cacheKey, hits);
  return hits;
}

/** Normalize a person/name fragment from Ask phrasing. */
export function cleanMailPersonName(raw: string): string | null {
  const who = raw
    .trim()
    .replace(/[?.!]+$/g, "")
    .replace(/\b(please|in my (?:inbox|email|mail)|for me)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return who.length >= 2 ? who : null;
}

/**
 * Extract the person the user is asking about for mail ("emails from X", "how about X").
 */
export function extractMailPersonName(question: string): string | null {
  const q = question.trim();
  if (!q) return null;

  const fromMatch =
    q.match(/\blook(?:ing)?\s+for\s+emails?\s+from\s+(.+?)(?:\?|[.!]|$)/i) ??
    q.match(/\b(?:emails?|e-mails?|mail|messages?|inbox)\s+from\s+(.+?)(?:\?|[.!]|looking|please|$)/i) ??
    q.match(
      /\bfrom\s+([A-Za-z][A-Za-z0-9.'\-]+(?:\s+[A-Za-z][A-Za-z0-9.'\-]+){0,3}?)(?=\s+(?:about|regarding|re|on|last|yesterday|today|in|at|around)|[?!.]|$)/i,
    ) ??
    q.match(
      /\b(?:sent|emailed)\s+(?:to me\s+)?by\s+([A-Za-z][A-Za-z0-9.'\-]+(?:\s+[A-Za-z][A-Za-z0-9.'\-]+){0,3}?)(?:\?|[.!]|$)/i,
    ) ??
    q.match(
      /\b(?:email|emails|mail|message)\s+([A-Za-z][A-Za-z0-9.'\-]+(?:\s+[A-Za-z][A-Za-z0-9.'\-]+)?)\s+sent\b/i,
    ) ??
    q.match(
      /\b([A-Za-z][A-Za-z0-9.'\-]+(?:\s+[A-Za-z][A-Za-z0-9.'\-]+)?)\s+(?:sent|emailed)\b/i,
    );

  if (fromMatch?.[1]) return cleanMailPersonName(fromMatch[1]);

  const aboutPerson =
    q.match(
      /\b(?:how about|what about|any (?:from|for)|and)\s+([A-Za-z][A-Za-z0-9.'\-]+(?:\s+[A-Za-z][A-Za-z0-9.'\-]+){0,3})\s*$/i,
    ) ??
    q.match(
      /^\s*([A-Za-z][A-Za-z0-9.'\-]+(?:\s+[A-Za-z][A-Za-z0-9.'\-]+){0,3})\s*$/,
    );
  if (aboutPerson?.[1] && !/\b(email|mail|spend|finance|calendar)\b/i.test(aboutPerson[1])) {
    return cleanMailPersonName(aboutPerson[1]);
  }

  return null;
}

/**
 * Prefer inbound mail whose From/display name/email overlaps the asked-for person,
 * then newest first. Display names often differ (e.g. "Bryant Permit Service" for Nancy Bryant).
 */
export function rankLiveGmailHitsForPerson(
  hits: LiveGmailHit[],
  personName: string,
): LiveGmailHit[] {
  const tokens = personName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  const score = (hit: LiveGmailHit): number => {
    const text = hit.text.toLowerCase();
    const fromLine = (text.match(/^from:\s*(.+)$/im)?.[1] ?? "").toLowerCase();
    const senderEmail = (text.match(/sender_email:\s*(\S+)/i)?.[1] ?? "").toLowerCase();
    const senderName = (text.match(/sender_name:\s*(.+)$/im)?.[1] ?? "").toLowerCase();
    const mailbox = hit.mailbox.toLowerCase();
    let s = 0;
    const fromBlob = `${fromLine} ${senderName} ${senderEmail}`;
    for (const t of tokens) {
      if (fromBlob.includes(t)) s += 40;
      else if (text.includes(t)) s += 8;
    }
    // Inbound (not sent by the connected mailbox) for "emails from X".
    if (mailbox && fromBlob.includes(mailbox)) s -= 25;
    else if (fromLine && !fromBlob.includes(mailbox)) s += 20;
    const ts = hit.sourceCreatedAt ? Date.parse(hit.sourceCreatedAt) : 0;
    s += Math.min(15, Math.floor(ts / 1e11)); // slight recency nudge
    return s;
  };
  return [...hits].sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    const ta = a.sourceCreatedAt ? Date.parse(a.sourceCreatedAt) : 0;
    const tb = b.sourceCreatedAt ? Date.parse(b.sourceCreatedAt) : 0;
    return tb - ta;
  });
}

/**
 * Build a Gmail API query from a natural-language Ask question.
 * "emails from Nancy Bryant" searches From + body/name tokens — From display
 * names often omit the person's first name (e.g. Bryant Permit Service).
 */
export function buildGmailSearchQuery(question: string): string | null {
  const q = question.trim();
  if (!q) return null;

  const fromMatch =
    q.match(/\blook(?:ing)?\s+for\s+emails?\s+from\s+(.+?)(?:\?|[.!]|$)/i) ??
    q.match(/\b(?:emails?|e-mails?|mail|messages?|inbox)\s+from\s+(.+?)(?:\?|[.!]|looking|please|$)/i) ??
    q.match(
      /\bfrom\s+([A-Za-z][A-Za-z0-9.'\-]+(?:\s+[A-Za-z][A-Za-z0-9.'\-]+){0,3}?)(?=\s+(?:about|regarding|re|on|last|yesterday|today|in|at|around)|[?!.]|$)/i,
    );

  if (fromMatch?.[1]) {
    const who = cleanMailPersonName(fromMatch[1]);
    if (who) return buildGmailPersonQuery(who);
  }

  const aboutMatch = q.match(
    /\b(?:emails?|mail|messages?)\s+(?:about|regarding|re)\s+(.+?)(?:\?|[.!]|$)/i,
  );
  if (aboutMatch?.[1]) {
    const topic = aboutMatch[1].trim().replace(/[?.!]+$/g, "").trim();
    if (topic.length >= 2) return topic;
  }

  return null;
}

/** Build a Gmail query for an explicit person name (follow-ups / history). */
export function buildGmailPersonQuery(personName: string, email?: string | null): string | null {
  const who = cleanMailPersonName(personName);
  if (!who) return null;
  const tokens = who.split(/\s+/).filter(Boolean);
  const fromParts = [
    `from:(${who})`,
    ...tokens.map((t) => `from:${t}`),
    `"${who}"`,
    `(${who})`,
  ];
  if (email?.trim()) fromParts.unshift(`from:${email.trim()}`);
  return `(${[...new Set(fromParts)].join(" OR ")})`;
}

export async function findGoogleConnectorByEmail(
  userId: string,
  email: string,
): Promise<ConnectorDto | null> {
  const rows = await getDb()
    .select()
    .from(connectors)
    .where(and(eq(connectors.userId, userId), eq(connectors.type, "google")));
  const needle = email.trim().toLowerCase();
  for (const row of rows) {
    const settings = openConnectorSettings(
      (row.settings ?? {}) as Record<string, unknown>,
    );
    const stored =
      typeof settings.googleEmail === "string"
        ? settings.googleEmail.toLowerCase()
        : "";
    if (stored === needle) return toDto(row);
  }
  return null;
}

export async function createGoogleConnectorForUser(
  userId: string,
  input: {
    email: string;
    displayName?: string | null;
    accessToken: string;
    refreshToken: string | null;
    expiresIn: number;
    scopes: string[];
  },
): Promise<ConnectorDto> {
  const now = new Date();
  const existingRows = await getDb()
    .select()
    .from(connectors)
    .where(and(eq(connectors.userId, userId), eq(connectors.type, "google")));
  const needle = input.email.trim().toLowerCase();
  const existing = existingRows.find((connector) => {
    const settings = openConnectorSettings(
      (connector.settings ?? {}) as Record<string, unknown>,
    );
    return (
      typeof settings.googleEmail === "string" &&
      settings.googleEmail.trim().toLowerCase() === needle
    );
  });
  if (existing) {
    const currentSettings = openConnectorSettings(
      (existing.settings ?? {}) as Record<string, unknown>,
    );
    const [row] = await getDb()
      .update(connectors)
      .set({
        enabled: true,
        syncStatus: "connected",
        settings: sealConnectorSettings({
          ...currentSettings,
          googleEmail: input.email,
          googleName: input.displayName ?? null,
          accessToken: input.accessToken,
          refreshToken:
            input.refreshToken ?? currentSettings.refreshToken ?? null,
          accessTokenExpiresAt: new Date(
            now.getTime() + input.expiresIn * 1000,
          ).toISOString(),
          grantedScopes:
            input.scopes.length > 0
              ? input.scopes
              : Array.isArray(currentSettings.grantedScopes)
                ? currentSettings.grantedScopes
                : [],
          googleAuthError: null,
        }),
        updatedAt: now,
      })
      .where(eq(connectors.id, existing.id))
      .returning();
    return toDto(row!);
  }

  const [row] = await getDb()
    .insert(connectors)
    .values({
      id: newConnectorId(),
      userId,
      name: `Google · ${input.email}`,
      type: "google",
      description: "Read-only Gmail, Calendar, Contacts, and Drive sync.",
      baseUrl: null,
      authType: "oauth",
      enabled: true,
      syncStatus: "connected",
      settings: sealConnectorSettings({
        googleEmail: input.email,
        googleName: input.displayName ?? null,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        accessTokenExpiresAt: new Date(
          now.getTime() + input.expiresIn * 1000,
        ).toISOString(),
        grantedScopes: input.scopes,
      }),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toDto(row!);
}

export function sourceRecordContentHashUnchanged(
  existingMetadata: Record<string, unknown> | null | undefined,
  incomingMetadata: Record<string, unknown> | null | undefined,
): boolean {
  const incoming =
    typeof incomingMetadata?.contentHash === "string"
      ? incomingMetadata.contentHash
      : null;
  const stored =
    typeof existingMetadata?.contentHash === "string"
      ? existingMetadata.contentHash
      : null;
  return Boolean(incoming && stored && incoming === stored);
}

export async function upsertSourceRecord(
  userId: string,
  connectorId: string,
  record: Awaited<ReturnType<RecallConnector["normalize"]>>[number],
  options?: { sanitized?: boolean },
): Promise<{ id: string; action: "created" | "updated" | "skipped" }> {
  if (!options?.sanitized) record = sanitizeNormalizedSourceRecord(record);
  const existing = await getDb()
    .select({
      id: sourceRecords.id,
      recordMetadata: sourceRecords.recordMetadata,
      sourceCreatedAt: sourceRecords.sourceCreatedAt,
      sourceUpdatedAt: sourceRecords.sourceUpdatedAt,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.connectorId, connectorId),
        eq(sourceRecords.externalId, record.externalId),
      ),
    )
    .limit(1);

  const now = new Date();
  if (existing[0]) {
    if (
      sourceRecordContentHashUnchanged(
        existing[0].recordMetadata,
        record.recordMetadata,
      )
    ) {
      // Advance Evernote's incremental checkpoint without rebuilding FTS or
      // embeddings. The DB trigger preserves its existing search vector when
      // contentHash/title/text are unchanged.
      await getDb()
        .update(sourceRecords)
        .set({
          recordMetadata: {
            ...(existing[0].recordMetadata ?? {}),
            ...(record.recordMetadata ?? {}),
          },
          sourceUpdatedAt: record.sourceUpdatedAt
            ? new Date(record.sourceUpdatedAt)
            : existing[0].sourceUpdatedAt,
          lastSyncedAt: now,
        })
        .where(eq(sourceRecords.id, existing[0].id));
      return { id: existing[0].id, action: "skipped" };
    }
    const meta = withSourceDigest(
      (record.recordMetadata ?? {}) as Record<string, unknown>,
      heuristicDigest(record.recordTitle ?? "", record.recordText ?? "", 400),
    );
    await getDb().transaction(async (tx) => {
      await tx
        .update(sourceRecords)
        .set({
          recordType: record.recordType,
          recordTitle: record.recordTitle ?? null,
          recordText: record.recordText ?? null,
          recordMetadata: meta,
          sourceUrl: record.sourceUrl ?? null,
          sourceCreatedAt: record.sourceCreatedAt
            ? new Date(record.sourceCreatedAt)
            : existing[0].sourceCreatedAt,
          sourceUpdatedAt: record.sourceUpdatedAt
            ? new Date(record.sourceUpdatedAt)
            : null,
          lastSyncedAt: now,
          updatedAt: now,
        })
        .where(eq(sourceRecords.id, existing[0].id));
      // Atomic with the content update: a changed row must never retain an ANN
      // vector for old content. Capped warmup may regenerate it; otherwise Ask
      // stays keyword/FTS-only.
      await tx
        .delete(entityEmbeddings)
        .where(
          and(
            eq(entityEmbeddings.userId, userId),
            eq(entityEmbeddings.entityType, "source_record"),
            eq(entityEmbeddings.entityId, existing[0].id),
          ),
        );
    });
    evictEntityEmbedding(userId, "source_record", existing[0].id);
    return { id: existing[0].id, action: "updated" };
  }

  const id = newSourceRecordId();
  const meta = withSourceDigest(
    (record.recordMetadata ?? {}) as Record<string, unknown>,
    heuristicDigest(record.recordTitle ?? "", record.recordText ?? "", 400),
  );
  await getDb().insert(sourceRecords).values({
    id,
    userId,
    connectorId,
    externalId: record.externalId,
    recordType: record.recordType,
    recordTitle: record.recordTitle ?? null,
    recordText: record.recordText ?? null,
    recordMetadata: meta,
    sourceUrl: record.sourceUrl ?? null,
    sourceCreatedAt: record.sourceCreatedAt ? new Date(record.sourceCreatedAt) : null,
    sourceUpdatedAt: record.sourceUpdatedAt ? new Date(record.sourceUpdatedAt) : null,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return { id, action: "created" };
}

/**
 * Bound source_record embedding warm after sync (respects the shared PG pool).
 * Warming the most recent records means the first Ask that touches them hits a
 * content-hash cache instead of paying a cold OpenAI embed on the request path.
 */
async function warmRecentSourceEmbeddings(
  userId: string,
  connectorId: string,
  opts: { recordType?: string; limit?: number; fallbackTitle?: string } = {},
): Promise<void> {
  const conds = [
    eq(sourceRecords.userId, userId),
    eq(sourceRecords.connectorId, connectorId),
  ];
  if (opts.recordType) conds.push(eq(sourceRecords.recordType, opts.recordType));

  const rows = await getDb()
    .select({
      id: sourceRecords.id,
      title: sourceRecords.recordTitle,
      text: sourceRecords.recordText,
      metadata: sourceRecords.recordMetadata,
    })
    .from(sourceRecords)
    .where(and(...conds))
    .orderBy(desc(sourceRecords.updatedAt))
    .limit(opts.limit ?? 40);

  for (const row of rows) {
    const digest =
      typeof row.metadata?.digest === "string" ? row.metadata.digest : null;
    warmEntityEmbedding(userId, {
      entityType: "source_record",
      entityId: row.id,
      text: digest
        ? `${row.title ?? opts.fallbackTitle ?? ""}\n${digest}`
        : `${row.title ?? ""}\n${(row.text ?? "").slice(0, 800)}`,
    });
  }
}

/** Evernote import is permanently keyword-only; retained for compatibility. */
export function evernoteEmbeddingSyncLimit(): number {
  return 0;
}

export function evernoteEmbeddingDailyLimit(): number {
  return 0;
}

type EvernoteWorkerCheckpoint = {
  startIndex: number;
  expectedTotal: number | null;
  recordsFetched: number;
  recordsSkipped: number;
  recordsFailed: number;
  batchesProcessed: number;
  listingAuthoritative: boolean;
};

function checkpointFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Partial<EvernoteWorkerCheckpoint> {
  const value = metadata?.evernoteCheckpoint;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Partial<EvernoteWorkerCheckpoint>)
    : {};
}

async function loadEvernoteKnownNotes(
  connectorId: string,
  externalIds: string[],
): Promise<Map<string, EvernoteKnownNote>> {
  if (externalIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      externalId: sourceRecords.externalId,
      metadata: sourceRecords.recordMetadata,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.connectorId, connectorId),
        eq(sourceRecords.recordType, "evernote_note"),
        inArray(sourceRecords.externalId, externalIds),
      ),
    );
  const notes = new Map<string, EvernoteKnownNote>();
  for (const row of rows) {
    const metadata = row.metadata ?? {};
    const usn = metadata.usn ?? metadata.updateSequenceNum;
    notes.set(row.externalId, {
      updateSequenceNum:
        typeof usn === "number" && Number.isFinite(usn) ? usn : null,
      contentHash:
        typeof metadata.contentHash === "string"
          ? metadata.contentHash
          : null,
      notebookGuid:
        typeof metadata.notebookGuid === "string"
          ? metadata.notebookGuid
          : null,
      notebookName:
        typeof metadata.notebookName === "string"
          ? metadata.notebookName
          : null,
      tagGuids: Array.isArray(metadata.tagGuids)
        ? metadata.tagGuids.filter(
            (tag): tag is string => typeof tag === "string",
          )
        : [],
      tagNames: Array.isArray(metadata.tagNames)
        ? metadata.tagNames.filter(
            (tag): tag is string => typeof tag === "string",
          )
        : [],
      evernoteUpdated:
        typeof metadata.evernoteUpdated === "string"
          ? metadata.evernoteUpdated
          : null,
      trashed: metadata.trashed === true,
      evernoteSeenSyncRunId:
        typeof metadata.evernoteSeenSyncRunId === "string"
          ? metadata.evernoteSeenSyncRunId
          : null,
      evernoteSeenAtIndex:
        typeof metadata.evernoteSeenAtIndex === "number"
          ? metadata.evernoteSeenAtIndex
          : null,
      evernoteProcessedSyncRunId:
        typeof metadata.evernoteProcessedSyncRunId === "string"
          ? metadata.evernoteProcessedSyncRunId
          : null,
      evernoteProcessedAtIndex:
        typeof metadata.evernoteProcessedAtIndex === "number"
          ? metadata.evernoteProcessedAtIndex
          : null,
    });
  }
  return notes;
}

async function markEvernoteRecordsSeen(
  connectorId: string,
  syncRunId: string,
  seen: Array<{ externalId: string; listingIndex: number }>,
): Promise<void> {
  for (const item of seen) {
    const marker = JSON.stringify({
      evernoteSeenSyncRunId: syncRunId,
      evernoteSeenAtIndex: item.listingIndex,
    });
    await getDb()
      .update(sourceRecords)
      .set({
        recordMetadata: sql`coalesce(${sourceRecords.recordMetadata}, '{}'::jsonb) || ${marker}::jsonb`,
        lastSyncedAt: new Date(),
      })
      .where(
        and(
          eq(sourceRecords.connectorId, connectorId),
          eq(sourceRecords.externalId, item.externalId),
        ),
      );
  }
}

async function markEvernoteRecordsProcessed(
  connectorId: string,
  syncRunId: string,
  seen: Array<{ externalId: string; listingIndex: number }>,
): Promise<void> {
  for (const item of seen) {
    const marker = JSON.stringify({
      evernoteProcessedSyncRunId: syncRunId,
      evernoteProcessedAtIndex: item.listingIndex,
    });
    await getDb()
      .update(sourceRecords)
      .set({
        recordMetadata: sql`coalesce(${sourceRecords.recordMetadata}, '{}'::jsonb) || ${marker}::jsonb`,
        lastSyncedAt: new Date(),
      })
      .where(
        and(
          eq(sourceRecords.connectorId, connectorId),
          eq(sourceRecords.externalId, item.externalId),
        ),
      );
  }
}

async function removeUnseenEvernoteRecords(
  userId: string,
  connectorId: string,
  syncRunId: string,
): Promise<number> {
  let removed = 0;
  for (;;) {
    const rows = await getDb()
      .select({ externalId: sourceRecords.externalId })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.userId, userId),
          eq(sourceRecords.connectorId, connectorId),
          eq(sourceRecords.recordType, "evernote_note"),
          sql`coalesce(${sourceRecords.recordMetadata}->>'evernoteSeenSyncRunId', '') <> ${syncRunId}`,
        ),
      )
      .limit(100);
    if (rows.length === 0) return removed;
    removed += await removeDeletedEvernoteRecords(
      userId,
      connectorId,
      rows.map((row) => row.externalId),
    );
  }
}

export function googleSyncMaxRowsPerTick(): number {
  const parsed = Number.parseInt(
    process.env.RECALL_GOOGLE_SYNC_MAX_ROWS_PER_TICK?.trim() ?? "",
    10,
  );
  if (!Number.isFinite(parsed)) return 500;
  return Math.min(5_000, Math.max(1, parsed));
}

type GoogleRunMetadata = {
  googleSync?: {
    since?: string | null;
    cursor?: GoogleSyncCursor | null;
    sources?: Record<
      string,
      {
        ok: boolean;
        count: number;
        consumedRows: number;
        error: string | null;
        errorStatus: number | null;
      }
    >;
    rowsProcessed?: number;
    calendarTimeMin?: string;
    calendarTimeMax?: string;
    scheduled?: boolean;
  };
};

function googleCursorFromMetadata(
  metadata: Record<string, unknown>,
): GoogleSyncCursor | null {
  const sync = (metadata as GoogleRunMetadata).googleSync;
  const cursor = sync?.cursor;
  if (
    !cursor ||
    !["gmail", "calendar", "contacts", "drive"].includes(cursor.source)
  ) {
    return null;
  }
  return {
    source: cursor.source,
    pageToken: typeof cursor.pageToken === "string" ? cursor.pageToken : null,
  };
}

function mergeGoogleSourceResults(
  metadata: Record<string, unknown>,
  results: GoogleSourceResult[],
): {
  sources: NonNullable<NonNullable<GoogleRunMetadata["googleSync"]>["sources"]>;
  sourceErrors: Record<string, string>;
} {
  const current = (metadata as GoogleRunMetadata).googleSync?.sources ?? {};
  const sources = { ...current };
  for (const result of results) {
    const prior = sources[result.source];
    sources[result.source] = {
      ok: (prior?.ok ?? true) && result.ok,
      count: (prior?.count ?? 0) + result.count,
      consumedRows: (prior?.consumedRows ?? 0) + result.consumedRows,
      error: result.error ?? prior?.error ?? null,
      errorStatus: result.errorStatus ?? prior?.errorStatus ?? null,
    };
  }
  const sourceErrors = Object.fromEntries(
    Object.entries(sources)
      .filter(([, result]) => Boolean(result.error))
      .map(([source, result]) => [source, result.error!]),
  );
  return { sources, sourceErrors };
}

type NormalizedConnectorRecord = Awaited<
  ReturnType<RecallConnector["normalize"]>
>[number];

async function persistGoogleNormalizedRecordsBatch(
  userId: string,
  connectorId: string,
  normalized: NormalizedConnectorRecord[],
): Promise<{ created: number; updated: number }> {
  if (normalized.length === 0) return { created: 0, updated: 0 };

  return getDb().transaction(async (tx) => {
    const externalIds = normalized.map((record) => record.externalId);
    const existing = await tx
      .select({
        id: sourceRecords.id,
        externalId: sourceRecords.externalId,
      })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.connectorId, connectorId),
          inArray(sourceRecords.externalId, externalIds),
        ),
      );
    const existingByExternalId = new Map(
      existing.map((record) => [record.externalId, record.id]),
    );
    const now = new Date();
    const rows = normalized.map((record) => ({
      id: existingByExternalId.get(record.externalId) ?? newSourceRecordId(),
      userId,
      connectorId,
      externalId: record.externalId,
      recordType: record.recordType,
      recordTitle: record.recordTitle ?? null,
      recordText: record.recordText ?? null,
      recordMetadata: withSourceDigest(
        (record.recordMetadata ?? {}) as Record<string, unknown>,
        heuristicDigest(record.recordTitle ?? "", record.recordText ?? "", 400),
      ),
      sourceUrl: record.sourceUrl ?? null,
      sourceCreatedAt: record.sourceCreatedAt
        ? new Date(record.sourceCreatedAt)
        : null,
      sourceUpdatedAt: record.sourceUpdatedAt
        ? new Date(record.sourceUpdatedAt)
        : null,
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    }));

    await tx
      .insert(sourceRecords)
      .values(rows)
      .onConflictDoUpdate({
        target: [sourceRecords.connectorId, sourceRecords.externalId],
        set: {
          recordType: sql`excluded.record_type`,
          recordTitle: sql`excluded.record_title`,
          recordText: sql`excluded.record_text`,
          recordMetadata: sql`excluded.record_metadata`,
          sourceUrl: sql`excluded.source_url`,
          sourceCreatedAt: sql`excluded.source_created_at`,
          sourceUpdatedAt: sql`excluded.source_updated_at`,
          lastSyncedAt: now,
          updatedAt: now,
        },
      });

    const changedExistingIds = existing.map((record) => record.id);
    if (changedExistingIds.length > 0) {
      await tx
        .delete(entityEmbeddings)
        .where(
          and(
            eq(entityEmbeddings.userId, userId),
            eq(entityEmbeddings.entityType, "source_record"),
            inArray(entityEmbeddings.entityId, changedExistingIds),
          ),
        );
    }

    const sourceRecordIds = rows.map((row) => row.id);
    await tx
      .delete(evidence)
      .where(
        and(
          eq(evidence.userId, userId),
          inArray(evidence.sourceRecordId, sourceRecordIds),
        ),
      );
    const evidenceRows = normalized.flatMap((record, index) =>
      googleConnector.mapEvidence(record).map((item) => ({
        id: newEvidenceId(),
        userId,
        entityType: "source_record",
        entityId: rows[index]!.id,
        claimType: item.claimType,
        sourceRecordId: rows[index]!.id,
        evidenceText: item.evidenceText ?? null,
        url: item.url ?? null,
        rowNumber: item.rowNumber ?? null,
        createdAt: now,
        updatedAt: now,
      })),
    );
    if (evidenceRows.length > 0) {
      await tx.insert(evidence).values(evidenceRows);
    }

    return {
      created: normalized.length - existing.length,
      updated: existing.length,
    };
  });
}

async function persistGoogleRecordsBatch(
  userId: string,
  connectorId: string,
  records: GoogleBundleResult["records"],
): Promise<{
  created: number;
  updated: number;
  failed: number;
  errors: string[];
}> {
  const normalized = await googleConnector.normalize(records);
  try {
    return {
      ...(await persistGoogleNormalizedRecordsBatch(
        userId,
        connectorId,
        normalized,
      )),
      failed: 0,
      errors: [],
    };
  } catch (error) {
    if (!isSkippableConnectorRecordError(error)) throw error;
    logger.warn(
      {
        connectorId,
        batchSize: normalized.length,
        code: databaseErrorCode(error),
      },
      "Google record batch rejected; isolating invalid record",
    );
  }

  let created = 0;
  let updated = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const record of normalized) {
    try {
      const result = await persistGoogleNormalizedRecordsBatch(
        userId,
        connectorId,
        [record],
      );
      created += result.created;
      updated += result.updated;
    } catch (error) {
      if (!isSkippableConnectorRecordError(error)) throw error;
      failed += 1;
      const code = databaseErrorCode(error) ?? "database_error";
      errors.push(`${record.externalId} skipped (${code})`);
      logger.warn(
        {
          connectorId,
          externalId: record.externalId,
          code,
        },
        "Skipped invalid Google connector record",
      );
    }
  }
  return { created, updated, failed, errors };
}

export async function enqueueGoogleSyncForUser(
  userId: string,
  connectorId: string,
  options?: { scheduled?: boolean },
): Promise<{
  syncRunId: string;
  jobId: string;
  status: string;
  deduped: boolean;
}> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`google-sync:${connectorId}`}, 0))`,
    );
    const connectorRows = await tx
      .select()
      .from(connectors)
      .where(
        and(
          eq(connectors.id, connectorId),
          eq(connectors.userId, userId),
          eq(connectors.type, "google"),
        ),
      )
      .limit(1);
    const connector = connectorRows[0];
    if (!connector) throw new Error("Google connector not found");
    if (!connector.enabled) {
      const error = new Error(
        `${connector.name} is paused; enable it before syncing`,
      ) as Error & { status?: number };
      error.status = 409;
      throw error;
    }

    const active = await tx
      .select({ id: syncRuns.id, status: syncRuns.status })
      .from(syncRuns)
      .innerJoin(jobs, eq(jobs.id, syncRuns.id))
      .where(
        and(
          eq(syncRuns.userId, userId),
          eq(syncRuns.connectorId, connectorId),
          inArray(syncRuns.status, ["queued", "running"]),
          inArray(jobs.status, ["queued", "processing"]),
        ),
      )
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);
    if (active[0]) {
      return {
        syncRunId: active[0].id,
        jobId: active[0].id,
        status: active[0].status,
        deduped: true,
      };
    }

    const syncRunId = newSyncRunId();
    const now = new Date();
    const calendarTimeMin = new Date(
      now.getTime() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const calendarTimeMax = new Date(
      now.getTime() + 90 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await tx.insert(syncRuns).values({
      id: syncRunId,
      userId,
      connectorId,
      status: "queued",
      startedAt: now,
      sourceErrors: {},
      metadata: {
        googleSync: {
          since: connector.lastSyncAt?.toISOString() ?? null,
          cursor: null,
          sources: {},
          rowsProcessed: 0,
          calendarTimeMin,
          calendarTimeMax,
          scheduled: options?.scheduled === true,
        },
      },
    });
    await tx.insert(jobs).values({
      id: syncRunId,
      userId,
      type: "connector_sync",
      payload: { connectorId, syncRunId, connectorType: "google" },
      status: "queued",
      attempts: 0,
      maxAttempts: GOOGLE_SYNC_MAX_CURSOR_RETRIES,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await tx
      .update(connectors)
      .set({ syncStatus: "syncing", updatedAt: now })
      .where(eq(connectors.id, connectorId));
    return {
      syncRunId,
      jobId: syncRunId,
      status: "queued",
      deduped: false,
    };
  });
}

async function processGoogleSyncJobLocked(
  userId: string,
  connectorId: string,
  syncRunId: string,
): Promise<boolean> {
  const connectorRows = await getDb()
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.id, connectorId),
        eq(connectors.userId, userId),
        eq(connectors.type, "google"),
      ),
    )
    .limit(1);
  const conn = connectorRows[0];
  if (!conn) throw new Error("Google connector not found");
  const runRows = await getDb()
    .select()
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.id, syncRunId),
        eq(syncRuns.userId, userId),
        eq(syncRuns.connectorId, connectorId),
      ),
    )
    .limit(1);
  const run = runRows[0];
  if (!run) throw new Error("Google sync run not found");
  if (
    run.status === "complete" ||
    run.status === "partial_success" ||
    run.status === "failed"
  )
    return true;
  if (!conn.enabled) throw new Error("Google connector is paused");

  const metadata = run.metadata ?? {};
  const googleState = (metadata as GoogleRunMetadata).googleSync ?? {};
  const cursor = googleCursorFromMetadata(metadata);
  const maxRows = googleSyncMaxRowsPerTick();

  try {
    let token = await ensureGoogleAccessToken(conn);
    let bundle = await fetchGoogleBundle(token.accessToken, token.mailbox, {
      since: typeof googleState.since === "string" ? googleState.since : null,
      cursor,
      maxRows,
      calendarTimeMin:
        typeof googleState.calendarTimeMin === "string"
          ? googleState.calendarTimeMin
          : undefined,
      calendarTimeMax:
        typeof googleState.calendarTimeMax === "string"
          ? googleState.calendarTimeMax
          : undefined,
    });
    if (
      bundle.sources.some((source) => source.errorStatus === 401)
    ) {
      token = await ensureGoogleAccessToken(conn, { forceRefresh: true });
      bundle = await fetchGoogleBundle(token.accessToken, token.mailbox, {
        since: typeof googleState.since === "string" ? googleState.since : null,
        cursor,
        maxRows,
        calendarTimeMin:
          typeof googleState.calendarTimeMin === "string"
            ? googleState.calendarTimeMin
            : undefined,
        calendarTimeMax:
          typeof googleState.calendarTimeMax === "string"
            ? googleState.calendarTimeMax
            : undefined,
      });
    }

    const persisted = await persistGoogleRecordsBatch(
      userId,
      connectorId,
      bundle.records,
    );
    const merged = mergeGoogleSourceResults(metadata, bundle.sources);
    const rowsProcessed =
      (Number(googleState.rowsProcessed) || 0) + bundle.rowsConsumed;
    const recordsFetched = run.recordsFetched + bundle.records.length;
    const recordsCreated = run.recordsCreated + persisted.created;
    const recordsUpdated = run.recordsUpdated + persisted.updated;
    const recordsFailed = Math.max(
      run.recordsFailed + persisted.failed,
      Object.keys(merged.sourceErrors).length,
    );
    const complete = bundle.complete;
    const partial =
      Object.keys(merged.sourceErrors).length > 0 || recordsFailed > 0;
    const incrementalSourceFailed = Boolean(
      merged.sourceErrors.gmail ||
        merged.sourceErrors.drive ||
        persisted.failed > 0,
    );
    const sourceErrorMessage = Object.entries(merged.sourceErrors)
      .map(([source, error]) => `${source}: ${error}`)
      .join("; ")
      .slice(0, 2_000);
    const errorMessage = sourceErrorMessage
      ? sourceErrorMessage
      : recordsFailed > 0
        ? `Google sync skipped ${recordsFailed} invalid record(s); see run metadata`
        : null;
    const priorErrors = Array.isArray(metadata.errors)
      ? metadata.errors.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    const nextMetadata = {
      ...metadata,
      errors: [...priorErrors, ...persisted.errors].slice(-100),
      googleSync: {
        ...googleState,
        cursor: bundle.nextCursor,
        sources: merged.sources,
        rowsProcessed,
      },
    };
    const memory = process.memoryUsage();

    await getDb()
      .update(syncRuns)
      .set({
        status: complete
          ? partial
            ? "partial_success"
            : "complete"
          : "running",
        completedAt: complete ? new Date() : null,
        recordsFetched,
        recordsCreated,
        recordsUpdated,
        recordsFailed,
        errorMessage,
        sourceErrors: merged.sourceErrors,
        metadata: nextMetadata,
      })
      .where(eq(syncRuns.id, syncRunId));

    if (complete) {
      await getDb()
        .update(connectors)
        .set({
          syncStatus: partial ? "partial_success" : "connected",
          // Use the run start as the incremental high-water mark. This
          // intentionally overlaps the next query so records arriving while
          // this run was paging cannot fall into a completion-time gap.
          ...(incrementalSourceFailed ? {} : { lastSyncAt: run.startedAt }),
          updatedAt: new Date(),
        })
        .where(eq(connectors.id, connectorId));
      await writeAuditLog({
        userId,
        action: "connector_sync",
        entityType: "connector",
        entityId: connectorId,
        metadata: {
          syncRunId,
          recordsFetched,
          recordsCreated,
          recordsUpdated,
          recordsFailed,
          sourceErrors: merged.sourceErrors,
        },
      });
    }

    logger.info(
      {
        connectorId,
        syncRunId,
        rowsThisTick: bundle.rowsConsumed,
        rowsProcessed,
        maxRows,
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        complete,
      },
      "Google sync job tick complete",
    );
    return complete;
  } catch (error) {
    const memory = process.memoryUsage();
    logger.warn(
      {
        error: safeConnectorErrorMessage(error),
        connectorId,
        syncRunId,
        rowsProcessed: run.recordsFetched,
        rss: memory.rss,
        heapUsed: memory.heapUsed,
      },
      "Google sync job tick failed",
    );
    if (isGoogleNeedsReauthError(error)) {
      const message =
        error instanceof Error
          ? error.message
          : "Google authorization was revoked — reconnect Google";
      await getDb()
        .update(syncRuns)
        .set({
          status: "failed",
          completedAt: new Date(),
          errorMessage: message,
          sourceErrors: { auth: message },
          metadata: {
            ...metadata,
            errors: [message],
          },
        })
        .where(eq(syncRuns.id, syncRunId));
    }
    throw error;
  }
}

export async function processGoogleSyncJob(
  userId: string,
  connectorId: string,
  syncRunId: string,
  heartbeat?: () => Promise<void>,
): Promise<boolean> {
  return withDbAdvisoryLock(`google-sync:${connectorId}`, async () => {
    // Created inside the advisory-lock AsyncLocalStorage scope so heartbeats
    // share this job's single checked-out PG connection.
    const lease = heartbeat
      ? setInterval(() => void heartbeat().catch(() => undefined), 60_000)
      : null;
    lease?.unref?.();
    try {
      return await processGoogleSyncJobLocked(userId, connectorId, syncRunId);
    } finally {
      if (lease) clearInterval(lease);
    }
  },
  );
}

export async function enqueueEvernoteSyncForUser(
  userId: string,
  connectorId: string,
  mode: "full" | "incremental" = "full",
  options?: { scheduled?: boolean },
): Promise<{ syncRunId: string; jobId: string; status: string }> {
  const rows = await getDb()
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.id, connectorId),
        eq(connectors.userId, userId),
        eq(connectors.type, "evernote"),
      ),
    )
    .limit(1);
  const connector = rows[0];
  if (!connector) throw new Error("Evernote connector not found");
  if (!connector.enabled) {
    const error = new Error(
      `${connector.name} is paused; enable it before syncing`,
    ) as Error & { status?: number };
    error.status = 409;
    throw error;
  }

  const queued = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`evernote-sync:${connectorId}`}, 0))`,
    );
    const active = await tx
      .select({
        id: syncRuns.id,
        status: syncRuns.status,
        metadata: syncRuns.metadata,
      })
      .from(syncRuns)
      .innerJoin(jobs, eq(jobs.id, syncRuns.id))
      .where(
        and(
          eq(syncRuns.userId, userId),
          eq(syncRuns.connectorId, connectorId),
          inArray(syncRuns.status, ["queued", "running"]),
          inArray(jobs.status, ["queued", "processing"]),
        ),
      )
      .orderBy(desc(syncRuns.startedAt));
    const reusable = activeEvernoteRunForMode(active, mode);
    if (reusable) {
      return {
        syncRunId: reusable.id,
        jobId: reusable.id,
        status: reusable.status,
      };
    }

    const syncRunId = newSyncRunId();
    const now = new Date();
    await tx.insert(syncRuns).values({
      id: syncRunId,
      userId,
      connectorId,
      status: "queued",
      startedAt: now,
      metadata: {
        evernoteSyncMode: mode,
        evernoteScheduled: options?.scheduled === true,
        evernotePhase: "notes",
        evernoteLookupProgress: { cached: 0, fetched: 0 },
        evernoteCheckpoint: {
          startIndex: 0,
          expectedTotal: null,
          recordsFetched: 0,
          recordsSkipped: 0,
          recordsFailed: 0,
          batchesProcessed: 0,
          listingAuthoritative: true,
        },
        recordsDeferred: 0,
        recordsDeleted: 0,
        recordsEmbedded: 0,
        evernoteEmbeddingReserved: 0,
        errors: [],
      },
    });
    await tx.insert(jobs).values({
      id: syncRunId,
      userId,
      type: "connector_sync",
      payload: { connectorId, syncRunId },
      status: "queued",
      attempts: 0,
      maxAttempts: 3,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await tx
      .update(connectors)
      .set({ syncStatus: "syncing", updatedAt: now })
      .where(eq(connectors.id, connectorId));
    return { syncRunId, jobId: syncRunId, status: "queued" };
  });
  return queued;
}

type ActiveEvernoteRun = {
  id: string;
  status: string;
  metadata: Record<string, unknown>;
};

export function isEvernoteAttachmentBackfill(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return (
    metadata?.evernoteSyncMode !== "incremental" &&
    metadata?.evernotePhase === "attachments"
  );
}

export function activeEvernoteRunForMode(
  active: ActiveEvernoteRun[],
  mode: "full" | "incremental",
): ActiveEvernoteRun | null {
  if (active.length === 0) return null;
  if (mode === "full") {
    return (
      active.find((run) => run.metadata?.evernoteSyncMode !== "incremental") ??
      active[0] ??
      null
    );
  }
  const incremental = active.find(
    (run) => run.metadata?.evernoteSyncMode === "incremental",
  );
  if (incremental) return incremental;
  return (
    active.find((run) => !isEvernoteAttachmentBackfill(run.metadata)) ?? null
  );
}

export function hasActiveEvernoteIncrementalRun(
  active: Array<{ id: string; metadata: Record<string, unknown> }>,
  excludingRunId?: string,
): boolean {
  return active.some(
    (run) =>
      run.id !== excludingRunId &&
      run.metadata?.evernoteSyncMode === "incremental",
  );
}

export function nextEvernotePhaseAfterListing(
  mode: "full" | "incremental",
  trashPhase: boolean,
): "trash" | "attachments" | "incremental_complete" {
  if (!trashPhase) return "trash";
  return mode === "incremental" ? "incremental_complete" : "attachments";
}

export function withEvernoteLookupProgress(
  metadata: Record<string, unknown>,
  progress: {
    cached: number;
    fetched: number;
  },
  updatedAt = new Date(),
  phase: "notes" | "trash" = "notes",
): Record<string, unknown> {
  return {
    ...metadata,
    evernotePhase: phase,
    evernoteLookupProgress: {
      ...progress,
      updatedAt: updatedAt.toISOString(),
    },
  };
}

export async function processEvernoteSyncJob(
  userId: string,
  connectorId: string,
  syncRunId: string,
  heartbeat?: () => Promise<void>,
): Promise<boolean> {
  try {
    return await withDbAdvisoryLock(`evernote-sync:${connectorId}`, () =>
      processEvernoteSyncJobLocked(userId, connectorId, syncRunId, heartbeat),
    );
  } catch (error) {
    if (error instanceof DatabaseAdvisoryLockBusyError) {
      throw evernoteDeferredError(
        "another Evernote sync slice holds the connector lock",
        1_000,
      );
    }
    throw error;
  }
}

async function processEvernoteSyncJobLocked(
  userId: string,
  connectorId: string,
  syncRunId: string,
  heartbeat?: () => Promise<void>,
): Promise<boolean> {
  const [connectorRows, runRows] = await Promise.all([
    getDb()
      .select()
      .from(connectors)
      .where(
        and(
          eq(connectors.id, connectorId),
          eq(connectors.userId, userId),
          eq(connectors.type, "evernote"),
        ),
      )
      .limit(1),
    getDb()
      .select()
      .from(syncRuns)
      .where(
        and(eq(syncRuns.id, syncRunId), eq(syncRuns.userId, userId)),
      )
      .limit(1),
  ]);
  const connector = connectorRows[0];
  const run = runRows[0];
  if (!connector || !run) throw new Error("Evernote sync job target not found");
  if (run.status === "complete" || run.status === "partial_success") return true;
  if (!connector.enabled) throw new Error("Evernote connector is paused");
  const persistedPhase =
    typeof run.metadata?.evernotePhase === "string"
      ? run.metadata.evernotePhase
      : "active";
  if (
    (persistedPhase === "attachments" ||
      (run.metadata?.evernoteScheduled === true &&
        run.metadata?.evernoteSyncMode !== "incremental")) &&
    !isEvernoteNightWindow()
  ) {
    throw evernoteDeferredError(
      persistedPhase === "attachments"
        ? "Evernote attachment backfill is outside the night window"
        : "scheduled full reconcile is outside the Evernote night window",
      60 * 60_000,
    );
  }
  try {
    await assertEvernoteImportSafe();
  } catch (error) {
    if (error instanceof EvernoteWatchdogPauseError) {
      await getDb()
        .insert(evernoteSyncState)
        .values({
          connectorId,
          userId,
          phase: "paused",
          watchdogPausedAt: new Date(),
          watchdogReason: error.message,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: evernoteSyncState.connectorId,
          set: {
            phase: "paused",
            watchdogPausedAt: new Date(),
            watchdogReason: error.message,
            updatedAt: new Date(),
          },
        });
    }
    throw error;
  }
  await getDb()
    .update(evernoteSyncState)
    .set({
      phase:
        typeof run.metadata?.evernotePhase === "string"
          ? run.metadata.evernotePhase
          : "active",
      watchdogPausedAt: null,
      watchdogReason: null,
      updatedAt: new Date(),
    })
    .where(eq(evernoteSyncState.connectorId, connectorId));

  const settings = openConnectorSettings(
    (connector.settings ?? {}) as Record<string, unknown>,
  );
  if (settings.authTransport !== "mcp") {
    await syncConnectorForUser(
      userId,
      connectorId,
      undefined,
      { syncRunId },
    );
    return true;
  }
  if (typeof settings.accessToken !== "string" || !settings.accessToken) {
    throw new Error("Evernote connector is missing OAuth credentials");
  }

  await getDb()
    .update(syncRuns)
    .set({ status: "running", completedAt: null, errorMessage: null })
    .where(eq(syncRuns.id, syncRunId));

  let metadata = { ...(run.metadata ?? {}) };
  let recordsCreated = run.recordsCreated;
  let recordsUpdated = run.recordsUpdated;
  let contentHashSkipped = Number(metadata.contentHashSkipped ?? 0) || 0;
  let processingFailures = Number(metadata.processingFailures ?? 0) || 0;
  let recordsEmbedded = Number(metadata.recordsEmbedded ?? 0) || 0;
  let embeddingReserved =
    Number(metadata.evernoteEmbeddingReserved ?? 0) || 0;
  let recordsDeleted = Number(metadata.recordsDeleted ?? 0) || 0;
  let errors = Array.isArray(metadata.errors)
    ? metadata.errors.filter((error): error is string => typeof error === "string")
    : [];

  const { streamEvernoteViaMcp, withEvernoteMcpClient } = await import(
    "../connectors/evernote-mcp"
  );
  const persistMcpState = async (next: Record<string, unknown>) => {
    await getDb()
      .update(connectors)
      .set({
        settings: sealConnectorSettings({ ...settings, ...next }),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connector.id));
  };

  const phase = persistedPhase;
  const syncMode =
    metadata.evernoteSyncMode === "incremental" ? "incremental" : "full";
  if (phase === "incremental_complete") {
    const completedAt = new Date();
    const recordsFailed = Number(run.recordsFailed);
    const status = recordsFailed > 0 ? "partial_success" : "complete";
    const activeRuns = await getDb()
      .select({ id: syncRuns.id, metadata: syncRuns.metadata })
      .from(syncRuns)
      .innerJoin(jobs, eq(jobs.id, syncRuns.id))
      .where(
        and(
          eq(syncRuns.connectorId, connectorId),
          inArray(syncRuns.status, ["queued", "running"]),
          inArray(jobs.status, ["queued", "processing"]),
        ),
      );
    const statePhase = activeRuns.some(
      (active) =>
        active.id !== syncRunId &&
        isEvernoteAttachmentBackfill(active.metadata),
    )
      ? "attachments"
      : "complete";
    metadata = { ...metadata, evernotePhase: "complete" };
    await getDb()
      .update(syncRuns)
      .set({
        status,
        completedAt,
        errorMessage: null,
        metadata,
      })
      .where(eq(syncRuns.id, syncRunId));
    await getDb()
      .update(connectors)
      .set({
        syncStatus: status === "complete" ? "connected" : "partial_success",
        lastSyncAt: completedAt,
        updatedAt: completedAt,
      })
      .where(eq(connectors.id, connectorId));
    await getDb()
      .insert(evernoteSyncState)
      .values({
        connectorId,
        userId,
        phase: statePhase,
        lastIncrementalAt: completedAt,
        updatedAt: completedAt,
      })
      .onConflictDoUpdate({
        target: evernoteSyncState.connectorId,
        set: {
          phase: statePhase,
          lastIncrementalAt: completedAt,
          watchdogPausedAt: null,
          watchdogReason: null,
          updatedAt: completedAt,
        },
      });
    return true;
  }
  if (phase === "attachments") {
    await resetInterruptedEvernoteAttachments(connectorId);
    const processed = await withEvernoteMcpClient(
      settings,
      (client) => processOneEvernoteAttachment(client, connectorId),
      persistMcpState,
    );
    await getDb()
      .update(connectors)
      .set({
        settings: sealConnectorSettings({ ...settings, ...processed.settings }),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connectorId));
    if (processed.value) {
      await heartbeat?.();
      return false;
    }
    const activeRuns = await getDb()
      .select({ id: syncRuns.id, metadata: syncRuns.metadata })
      .from(syncRuns)
      .innerJoin(jobs, eq(jobs.id, syncRuns.id))
      .where(
        and(
          eq(syncRuns.connectorId, connectorId),
          inArray(syncRuns.status, ["queued", "running"]),
          inArray(jobs.status, ["queued", "processing"]),
        ),
      );
    if (hasActiveEvernoteIncrementalRun(activeRuns, syncRunId)) {
      // An incremental note slice may still add/reset pending attachment rows.
      // Keep this durable backfill open until that run has checkpointed.
      await heartbeat?.();
      return false;
    }
    metadata = { ...metadata, evernotePhase: "tasks", evernoteTaskCursor: null };
    await getDb()
      .update(syncRuns)
      .set({ metadata })
      .where(eq(syncRuns.id, syncRunId));
    return false;
  }
  if (phase === "tasks") {
    const cursor =
      typeof metadata.evernoteTaskCursor === "string"
        ? metadata.evernoteTaskCursor
        : null;
    const processed = await withEvernoteMcpClient(
      settings,
      (client) =>
        processEvernoteTaskPage({
          client,
          userId,
          connectorId,
          cursor,
        }),
      persistMcpState,
    );
    await getDb()
      .update(connectors)
      .set({
        settings: sealConnectorSettings({ ...settings, ...processed.settings }),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connectorId));
    metadata = {
      ...metadata,
      evernoteTaskCursor: processed.value.nextCursor,
      evernoteTasksImported:
        (Number(metadata.evernoteTasksImported) || 0) + processed.value.count,
      evernotePhase: processed.value.complete ? "verification" : "tasks",
      evernoteVerificationOffset: 0,
    };
    await getDb()
      .update(syncRuns)
      .set({ metadata })
      .where(eq(syncRuns.id, syncRunId));
    await heartbeat?.();
    return false;
  }
  if (phase === "verification") {
    if (
      syncMode === "full" &&
      metadata.evernoteReminderFlagsSynced !== true
    ) {
      const reminders = await withEvernoteMcpClient(
        settings,
        (client) => syncEvernoteReminderFlags(client, connectorId),
        persistMcpState,
      );
      metadata = {
        ...metadata,
        evernoteReminderFlagsSynced: true,
        evernoteReminderCount: reminders.value,
      };
      await Promise.all([
        getDb()
          .update(syncRuns)
          .set({ metadata })
          .where(eq(syncRuns.id, syncRunId)),
        getDb()
          .update(connectors)
          .set({
            settings: sealConnectorSettings({
              ...settings,
              ...reminders.settings,
            }),
            updatedAt: new Date(),
          })
          .where(eq(connectors.id, connectorId)),
      ]);
      return false;
    }
    const offset = Math.max(
      0,
      Math.floor(Number(metadata.evernoteVerificationOffset) || 0),
    );
    if (syncMode === "full") {
      const processed = await withEvernoteMcpClient(
        settings,
        (client) => verifyOneEvernoteNotebook(client, connectorId, offset),
        persistMcpState,
      );
      await getDb()
        .update(connectors)
        .set({
          settings: sealConnectorSettings({
            ...settings,
            ...processed.settings,
          }),
          updatedAt: new Date(),
        })
        .where(eq(connectors.id, connectorId));
      if (processed.value) {
        metadata = {
          ...metadata,
          evernoteVerificationOffset: offset + 1,
        };
        await getDb()
          .update(syncRuns)
          .set({ metadata })
          .where(eq(syncRuns.id, syncRunId));
        await heartbeat?.();
        return false;
      }
    }
    const trashCheckpoint =
      metadata.evernoteTrashCheckpoint &&
      typeof metadata.evernoteTrashCheckpoint === "object"
        ? (metadata.evernoteTrashCheckpoint as Record<string, unknown>)
        : {};
    const existingReport =
      syncMode === "incremental"
        ? await getEvernoteCompletenessReport(userId, connectorId)
        : null;
    const report =
      existingReport ??
      (await buildEvernoteCompletenessReport(userId, connectorId, {
        expectedTrashCount:
          typeof trashCheckpoint.expectedTotal === "number"
            ? trashCheckpoint.expectedTotal
            : null,
        expectedTaskCount:
          typeof metadata.evernoteTasksImported === "number"
            ? metadata.evernoteTasksImported
            : null,
      }));
    const recordsSkipped = Number(run.recordsSkipped);
    const recordsFailed = Number(run.recordsFailed);
    const status = recordsFailed > 0 || !report.pass ? "partial_success" : "complete";
    metadata = { ...metadata, evernotePhase: "complete", verification: report };
    await getDb()
      .update(syncRuns)
      .set({
        status,
        completedAt: new Date(),
        errorMessage: null,
        recordsCreated,
        recordsUpdated,
        recordsSkipped,
        recordsFailed,
        metadata,
      })
      .where(eq(syncRuns.id, syncRunId));
    await getDb()
      .update(connectors)
      .set({
        syncStatus: status === "complete" ? "connected" : "partial_success",
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connectorId));
    const completedAt = new Date();
    await getDb()
      .insert(evernoteSyncState)
      .values({
        connectorId,
        userId,
        phase: "complete",
        report,
        lastIncrementalAt: completedAt,
        lastFullReconcileAt:
          syncMode === "full" ? completedAt : undefined,
        updatedAt: completedAt,
      })
      .onConflictDoUpdate({
        target: evernoteSyncState.connectorId,
        set: {
          phase: "complete",
          report,
          lastIncrementalAt: completedAt,
          ...(syncMode === "full"
            ? { lastFullReconcileAt: completedAt }
            : {}),
          watchdogPausedAt: null,
          watchdogReason: null,
          updatedAt: completedAt,
        },
      });
    return true;
  }

  const taxonomy =
    (await loadEvernoteTaxonomy(connectorId)) ?? {
      notebooks: [],
      tags: [],
      spaces: [],
    };
  const taxonomyMetadata = { ...metadata };
  delete taxonomyMetadata.evernoteTaxonomyCheckpoint;
  metadata = {
    ...taxonomyMetadata,
    evernotePhase: phase === "trash" ? "trash" : "notes",
    evernoteTaxonomyMode: "lazy",
  };
  if (phase !== "trash") {
    await getDb()
      .update(syncRuns)
      .set({ metadata })
      .where(eq(syncRuns.id, syncRunId));
  }
  const trashPhase = phase === "trash";
  const streamed = await withEvernoteMcpClient(
    settings,
    (client) =>
      streamEvernoteViaMcp(client, {
        syncRunId,
        checkpoint: checkpointFromMetadata(
          trashPhase
            ? {
                evernoteCheckpoint: metadata.evernoteTrashCheckpoint,
              }
            : metadata,
        ),
        query: trashPhase ? "intrash:true" : "",
        forceTrashed: trashPhase,
        partitionByNotebook: syncMode === "full",
        // Trash order is not guaranteed to reflect when a note was deleted.
        // Scan all trash summaries so an older newly trashed note cannot hide
        // behind an unchanged row; unchanged full notes are still not fetched.
        stopAtFirstUnchanged: syncMode === "incremental" && !trashPhase,
        taxonomy,
        taxonomyLookupProgress:
          metadata.evernoteLookupProgress &&
          typeof metadata.evernoteLookupProgress === "object"
            ? (metadata.evernoteLookupProgress as Record<string, number>)
            : undefined,
        onTaxonomyEntities: async (value) => {
          await persistEvernoteTaxonomy(userId, connectorId, value);
          await heartbeat?.();
        },
        loadKnownNotes: (externalIds) =>
          loadEvernoteKnownNotes(connectorId, externalIds),
        processBatch: async (batch) => {
          await markEvernoteRecordsSeen(
            connectorId,
            syncRunId,
            batch.seen,
          );
          const replayIds = new Set(batch.replayExternalIds);
          const indexById = new Map(
            batch.seen.map((item) => [item.externalId, item.listingIndex]),
          );
          for (const record of batch.records) {
            record.metadata = {
              ...record.metadata,
              evernoteSeenSyncRunId: syncRunId,
              evernoteSeenAtIndex:
                indexById.get(record.externalId) ?? null,
            };
          }

          const normalized = await evernoteConnector.normalize(batch.records);
          let batchProcessingError: Error | null = null;
          for (const normalizedRecord of normalized) {
            const record = sanitizeNormalizedSourceRecord(normalizedRecord);
            try {
              const upsert = await upsertSourceRecord(
                userId,
                connectorId,
                record,
                { sanitized: true },
              );
              if (upsert.action === "created") {
                recordsCreated += 1;
              } else if (upsert.action === "updated") {
                recordsUpdated += 1;
              } else {
                contentHashSkipped += 1;
                if (!replayIds.has(record.externalId)) continue;
                // The source row committed before a crash, but evidence/child
                // metadata work for this page did not finish.
              }
              for (const ev of evernoteConnector.mapEvidence(record)) {
                await upsertEvidenceForSourceRecord(userId, {
                  entityType: "source_record",
                  entityId: upsert.id,
                  claimType: ev.claimType,
                  sourceRecordId: upsert.id,
                  evidenceText: ev.evidenceText ?? null,
                  url: ev.url ?? null,
                  rowNumber: ev.rowNumber ?? null,
                });
              }
              await persistEvernoteRecordChildren({
                userId,
                connectorId,
                sourceRecordId: upsert.id,
                sourceUrl: record.sourceUrl ?? null,
                metadata:
                  (record.recordMetadata as Record<string, unknown> | undefined) ??
                  {},
              });
            } catch (error) {
              processingFailures += 1;
              const message =
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : "Source record upsert failed";
              errors.push(message);
              batchProcessingError =
                error instanceof Error ? error : new Error(message);
            }
          }
          if (batchProcessingError) {
            // Do not advance the durable checkpoint. The seen marker lets the
            // next retry replay a source row that committed before child work.
            throw batchProcessingError;
          }

          // Evernote import is intentionally local/keyword-only. It must never
          // call OpenAI or generate embeddings in a background sync.
          await markEvernoteRecordsProcessed(
            connectorId,
            syncRunId,
            batch.seen,
          );
          const currentRun = await getDb()
            .select({ metadata: syncRuns.metadata })
            .from(syncRuns)
            .where(eq(syncRuns.id, syncRunId))
            .limit(1);
          embeddingReserved =
            Number(
              currentRun[0]?.metadata?.evernoteEmbeddingReserved ??
                embeddingReserved,
            ) || 0;
          errors = [...errors, ...batch.errors].slice(-100);
          const failedNotes = [
            ...(Array.isArray(
              currentRun[0]?.metadata?.evernoteFailedNotes,
            )
              ? currentRun[0]!.metadata!.evernoteFailedNotes
              : []),
            ...batch.failedNotes,
          ].slice(-100);
          metadata = withEvernoteLookupProgress(
            {
              ...(currentRun[0]?.metadata ?? metadata),
              ...(trashPhase
                ? { evernoteTrashCheckpoint: batch.checkpoint }
                : { evernoteCheckpoint: batch.checkpoint }),
              contentHashSkipped,
              processingFailures,
              recordsDeleted,
              recordsEmbedded,
              evernoteEmbeddingReserved: embeddingReserved,
              errors,
              evernoteFailedNotes: failedNotes,
            },
            batch.taxonomyLookups,
            new Date(),
            trashPhase ? "trash" : "notes",
          );
          await getDb()
            .update(syncRuns)
            .set({
              recordsFetched:
                (trashPhase
                  ? Number(metadata.evernoteActiveFetched) || 0
                  : 0) + batch.checkpoint.recordsFetched,
              recordsCreated,
              recordsUpdated,
              recordsSkipped:
                (trashPhase
                  ? Number(metadata.evernoteActiveSkipped) || 0
                  : 0) +
                batch.checkpoint.recordsSkipped +
                contentHashSkipped,
              recordsFailed:
                (trashPhase
                  ? Number(metadata.evernoteActiveFailed) || 0
                  : 0) +
                batch.checkpoint.recordsFailed +
                processingFailures,
              metadata,
            })
            .where(eq(syncRuns.id, syncRunId));
          await heartbeat?.();
          logger.info(
            {
              syncRunId,
              connectorId,
              phase: trashPhase ? "trash" : "notes",
              notesFetched: batch.checkpoint.recordsFetched,
              notesCreated: recordsCreated,
              lookupsCached: batch.taxonomyLookups.cached,
              lookupsFetched: batch.taxonomyLookups.fetched,
            },
            "Evernote import progress",
          );
        },
        // Yield the shared worker regularly while keeping each page durable.
        maxBatchesPerInvocation: 4,
      }),
    persistMcpState,
  );

  await getDb()
    .update(connectors)
    .set({
      settings: sealConnectorSettings({
        ...settings,
        ...streamed.settings,
      }),
      updatedAt: new Date(),
    })
    .where(eq(connectors.id, connector.id));

  if (!streamed.value.listingComplete) {
    return false;
  }

  if (!trashPhase) {
    metadata = {
      ...metadata,
      evernoteCheckpoint: streamed.value,
      evernoteActiveFetched: streamed.value.recordsFetched,
      evernoteActiveSkipped: streamed.value.recordsSkipped,
      evernoteActiveFailed: streamed.value.recordsFailed,
      evernoteActiveAuthoritative: streamed.value.authoritativeListing,
      evernoteRetryReport:
        streamed.value.notebookCursor?.retryReport ?? [],
      evernoteTrashCheckpoint: {
        startIndex: 0,
        expectedTotal: null,
        recordsFetched: 0,
        recordsSkipped: 0,
        recordsFailed: 0,
        batchesProcessed: 0,
        listingAuthoritative: true,
      },
      evernotePhase: nextEvernotePhaseAfterListing(syncMode, false),
    };
    await getDb()
      .update(syncRuns)
      .set({ metadata })
      .where(eq(syncRuns.id, syncRunId));
    return false;
  }

  if (
    metadata.evernoteActiveAuthoritative === true &&
    streamed.value.authoritativeListing
  ) {
    recordsDeleted = await removeUnseenEvernoteRecords(
      userId,
      connectorId,
      syncRunId,
    );
  }
  metadata = {
    ...metadata,
    evernoteTrashCheckpoint: streamed.value,
    evernotePhase: nextEvernotePhaseAfterListing(syncMode, true),
    contentHashSkipped,
    processingFailures,
    recordsDeferred: 0,
    recordsDeleted,
    recordsEmbedded,
    evernoteEmbeddingReserved: embeddingReserved,
    errors,
  };
  await getDb()
    .update(syncRuns)
    .set({
      recordsFetched:
        (Number(metadata.evernoteActiveFetched) || 0) +
        streamed.value.recordsFetched,
      recordsCreated,
      recordsUpdated,
      recordsSkipped:
        (Number(metadata.evernoteActiveSkipped) || 0) +
        streamed.value.recordsSkipped +
        contentHashSkipped,
      recordsFailed:
        (Number(metadata.evernoteActiveFailed) || 0) +
        streamed.value.recordsFailed +
        processingFailures,
      metadata,
    })
    .where(eq(syncRuns.id, syncRunId));
  return false;
}

export async function failConnectorSyncRun(
  userId: string,
  syncRunId: string,
  errorMessage: string,
): Promise<void> {
  const rows = await getDb()
    .select({ connectorId: syncRuns.connectorId, metadata: syncRuns.metadata })
    .from(syncRuns)
    .where(and(eq(syncRuns.id, syncRunId), eq(syncRuns.userId, userId)))
    .limit(1);
  if (!rows[0]) return;
  await getDb()
    .update(syncRuns)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorMessage: errorMessage.slice(0, 1_000),
      metadata: {
        ...(rows[0].metadata ?? {}),
        errors: [
          ...(Array.isArray(rows[0].metadata?.errors)
            ? rows[0].metadata.errors.filter(
                (error): error is string => typeof error === "string",
              )
            : []),
          errorMessage.slice(0, 300),
        ].slice(-100),
      },
    })
    .where(eq(syncRuns.id, syncRunId));
  await getDb()
    .update(connectors)
    .set({
      syncStatus: sql`case
        when ${connectors.syncStatus} = 'needs_reauth' then 'needs_reauth'
        else 'sync_failed'
      end`,
      updatedAt: new Date(),
    })
    .where(eq(connectors.id, rows[0].connectorId));
}

export async function failConnectorJobAndRun(
  userId: string,
  jobId: string,
  syncRunId: string,
  errorMessage: string,
): Promise<void> {
  const now = new Date();
  const message = errorMessage.slice(0, 1_000);
  await getDb().transaction(async (tx) => {
    const rows = await tx
      .select({
        connectorId: syncRuns.connectorId,
        metadata: syncRuns.metadata,
      })
      .from(syncRuns)
      .where(and(eq(syncRuns.id, syncRunId), eq(syncRuns.userId, userId)))
      .limit(1);
    const run = rows[0];
    if (!run) throw new Error("Connector sync run not found during terminal failure");

    await tx
      .update(syncRuns)
      .set({
        status: "failed",
        completedAt: now,
        errorMessage: message,
        metadata: {
          ...(run.metadata ?? {}),
          errors: [
            ...(Array.isArray(run.metadata?.errors)
              ? run.metadata.errors.filter(
                  (error): error is string => typeof error === "string",
                )
              : []),
            message.slice(0, 300),
          ].slice(-100),
        },
      })
      .where(eq(syncRuns.id, syncRunId));
    await tx
      .update(connectors)
      .set({
        syncStatus: sql`case
          when ${connectors.syncStatus} = 'needs_reauth' then 'needs_reauth'
          else 'sync_failed'
        end`,
        updatedAt: now,
      })
      .where(eq(connectors.id, run.connectorId));
    const failedJobs = await tx
      .update(jobs)
      .set({
        status: "failed",
        lastError: message,
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.userId, userId),
          eq(jobs.status, "processing"),
        ),
      )
      .returning({ id: jobs.id });
    if (failedJobs.length !== 1) {
      throw new Error("Connector job was not processing during terminal failure");
    }
  });
}

export const failEvernoteSyncRun = failConnectorSyncRun;

export async function syncConnectorForUser(
  userId: string,
  connectorId: string,
  payload?: { csvText?: string; records?: unknown[] },
  execution?: { syncRunId?: string },
): Promise<{ syncRunId: string; result: { recordsFetched: number; recordsCreated: number; recordsUpdated: number; recordsSkipped: number; recordsDeferred: number; recordsDeleted: number; recordsFailed: number } }> {
  const connRows = await getDb()
    .select()
    .from(connectors)
    .where(and(eq(connectors.id, connectorId), eq(connectors.userId, userId)))
    .limit(1);
  const conn = connRows[0];
  if (!conn) throw new Error("Connector not found");
  if (!conn.enabled) {
    const error = new Error(
      `${conn.name} is paused; enable it before syncing`,
    ) as Error & { status?: number };
    error.status = 409;
    throw error;
  }

  const impl = CONNECTOR_IMPLS[conn.type];
  if (!impl) throw new Error(`Unsupported connector type: ${conn.type}`);

  const syncRunId = execution?.syncRunId ?? newSyncRunId();
  const started = new Date();
  if (execution?.syncRunId) {
    await getDb()
      .update(syncRuns)
      .set({
        status: "running",
        completedAt: null,
        errorMessage: null,
      })
      .where(
        and(
          eq(syncRuns.id, syncRunId),
          eq(syncRuns.userId, userId),
          eq(syncRuns.connectorId, connectorId),
        ),
      );
  } else {
    await getDb().insert(syncRuns).values({
      id: syncRunId,
      userId,
      connectorId,
      status: "running",
      startedAt: started,
      recordsFetched: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      recordsFailed: 0,
      metadata: {},
    });
  }

  let recordsFetched = 0;
  let recordsCreated = 0;
  let recordsUpdated = 0;
  let recordsSkipped = 0;
  let recordsDeferred = 0;
  let recordsDeleted = 0;
  let recordsEmbedded = 0;
  let evernoteEmbeddingReserved = 0;
  let recordsFailed = 0;
  let errorMessage: string | null = null;
  const syncErrors: string[] = [];

  try {
    let rawRecords: unknown[] = payload?.records ?? [];
    let evernoteFetch: EvernoteFetchResult | null = null;
    if (conn.type === "csv_import" && payload?.csvText) {
      rawRecords = parseCsvText(payload.csvText);
    }
    if (conn.type === "finance_api" && conn.baseUrl) {
      const apiKey = process.env.FINANCE_API_KEY ?? null;
      rawRecords = await fetchFinanceTransactions(conn.baseUrl, apiKey);
    }
    if (conn.type === "google") {
      rawRecords = await fetchGoogleRecordsForConnector(conn);
    }
    if (conn.type === "microsoft") {
      rawRecords = await fetchMicrosoftRecordsForConnector(conn);
    }
    if (conn.type === "homey") {
      rawRecords = await fetchHomeyRecordsForConnector(conn);
    }
    if (conn.type === "ticket_email") {
      rawRecords = await fetchTicketEmailRecordsForConnector(conn);
    }
    if (conn.type === "flipperforce") {
      rawRecords = await fetchFlipperForceRecordsForConnector(conn);
    }
    if (conn.type === "evernote") {
      evernoteFetch = await fetchEvernoteRecordsForConnector(conn);
      rawRecords = evernoteFetch.records;
      recordsDeleted = await removeDeletedEvernoteRecords(
        userId,
        connectorId,
        evernoteFetch.deletedExternalIds,
      );
    }

    const normalized = await impl.normalize(rawRecords);
    recordsFetched = evernoteFetch?.recordsFetched ?? normalized.length;
    recordsSkipped = evernoteFetch?.recordsSkipped ?? 0;
    recordsDeferred = evernoteFetch?.recordsDeferred ?? 0;
    recordsFailed = evernoteFetch?.recordsFailed ?? 0;
    syncErrors.push(...(evernoteFetch?.errors ?? []));

    for (const normalizedRecord of normalized) {
      const record = sanitizeNormalizedSourceRecord(normalizedRecord);
      try {
        const upsert = await upsertSourceRecord(
          userId,
          connectorId,
          record,
          { sanitized: true },
        );
        const sourceRecordId = upsert.id;
        if (upsert.action === "created") {
          recordsCreated++;
        } else if (upsert.action === "updated") {
          recordsUpdated++;
        } else {
          recordsSkipped++;
          continue;
        }

        for (const ev of impl.mapEvidence(record)) {
          await upsertEvidenceForSourceRecord(userId, {
            entityType: "source_record",
            entityId: sourceRecordId,
            claimType: ev.claimType,
            sourceRecordId,
            evidenceText: ev.evidenceText ?? null,
            url: ev.url ?? null,
            rowNumber: ev.rowNumber ?? null,
          });
        }
      } catch (error) {
        recordsFailed++;
        syncErrors.push(
          error instanceof Error
            ? error.message.slice(0, 300)
            : "Source record upsert failed",
        );
      }
    }

    if (conn.type === "homey") {
      void warmRecentSourceEmbeddings(userId, connectorId, {
        recordType: "homey_device",
        fallbackTitle: "Homey device",
      }).catch(() => undefined);
    } else if (conn.type === "flipperforce") {
      void warmRecentSourceEmbeddings(userId, connectorId, {
        recordType: "flipperforce_project",
        fallbackTitle: "FlipperForce project",
      }).catch(() => undefined);
    } else if (conn.type === "google" || conn.type === "microsoft") {
      // Warm freshly synced mail/calendar/drive/contact records across types.
      void warmRecentSourceEmbeddings(userId, connectorId, { limit: 60 }).catch(
        () => undefined,
      );
    } else if (conn.type === "evernote") {
      // Evernote import is always keyword-only and never generates embeddings.
      recordsEmbedded = 0;
      evernoteEmbeddingReserved = 0;
    }

    if (conn.type === "google") {
      // Promote calendar events + extract high-confidence Gmail deadlines.
      void (async () => {
        try {
          const { enqueueJob, JOB_TYPE_ATTENTION_SCAN, JOB_TYPE_WAITING_SCAN } =
            await import("./job-queue");
          const { nudgeJobWorker } = await import("./job-worker");
          const attentionJob = await enqueueJob({
            userId,
            type: JOB_TYPE_ATTENTION_SCAN,
            payload: { connectorId },
            id: `attn-scan-${userId}-${connectorId}-${Math.floor(Date.now() / 300_000)}`,
          });
          // Extract waiting-on commitments + classify replies in the same pass.
          const waitingJob = await enqueueJob({
            userId,
            type: JOB_TYPE_WAITING_SCAN,
            payload: { connectorId },
            id: `wait-scan-${userId}-${connectorId}-${Math.floor(Date.now() / 300_000)}`,
          });
          nudgeJobWorker(attentionJob.id);
          nudgeJobWorker(waitingJob.id);
        } catch {
          /* non-fatal */
        }
      })();
    }

    await getDb()
      .update(connectors)
      .set({
        syncStatus:
          recordsFailed > 0 || recordsDeferred > 0
            ? "partial_success"
            : "connected",
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connectorId));

    await getDb()
      .update(syncRuns)
      .set({
        status:
          recordsFailed > 0 || recordsDeferred > 0
            ? "partial_success"
            : "complete",
        completedAt: new Date(),
        recordsFetched,
        recordsCreated,
        recordsUpdated,
        recordsSkipped,
        recordsFailed,
        metadata: {
          recordsSkipped,
          recordsDeferred,
          recordsDeleted,
          recordsEmbedded,
          evernoteEmbeddingReserved,
          errors: syncErrors,
        },
      })
      .where(eq(syncRuns.id, syncRunId));
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Sync failed";
    const authFailed = err instanceof FlipperForceAuthError;
    await getDb()
      .update(connectors)
      .set({
        syncStatus: authFailed ? "authentication_failed" : "sync_failed",
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connectorId));
    await getDb()
      .update(syncRuns)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage,
        recordsFetched,
        recordsCreated,
        recordsUpdated,
        recordsSkipped,
        recordsFailed,
        metadata: {
          recordsSkipped,
          recordsDeferred,
          recordsDeleted,
          recordsEmbedded,
          evernoteEmbeddingReserved,
          errors: [
            ...syncErrors,
            ...(errorMessage ? [errorMessage.slice(0, 300)] : []),
          ],
        },
      })
      .where(eq(syncRuns.id, syncRunId));
    throw err;
  }

  await writeAuditLog({
    userId,
    action: "connector_sync",
    entityType: "connector",
    entityId: connectorId,
    metadata: {
      syncRunId,
      recordsFetched,
      recordsCreated,
      recordsUpdated,
      recordsSkipped,
      recordsDeferred,
      recordsDeleted,
      recordsFailed,
    },
  });

  return {
    syncRunId,
    result: {
      recordsFetched,
      recordsCreated,
      recordsUpdated,
      recordsSkipped,
      recordsDeferred,
      recordsDeleted,
      recordsFailed,
    },
  };
}

export async function writeGoogleConnectAudit(
  userId: string,
  connectorId: string,
  email: string,
): Promise<void> {
  await writeAuditLog({
    userId,
    action: "google_connected",
    entityType: "connector",
    entityId: connectorId,
    metadata: { googleEmail: email },
  });
}

export async function findMicrosoftConnectorByEmail(
  userId: string,
  email: string,
): Promise<ConnectorDto | null> {
  const rows = await getDb()
    .select()
    .from(connectors)
    .where(and(eq(connectors.userId, userId), eq(connectors.type, "microsoft")));
  const needle = email.trim().toLowerCase();
  for (const row of rows) {
    const settings = (row.settings ?? {}) as Record<string, unknown>;
    const stored =
      typeof settings.microsoftEmail === "string"
        ? settings.microsoftEmail.toLowerCase()
        : "";
    if (stored === needle) return toDto(row);
  }
  return null;
}

export async function createMicrosoftConnectorForUser(
  userId: string,
  input: {
    email: string;
    displayName?: string | null;
    accessToken: string;
    refreshToken: string | null;
    expiresIn: number;
  },
): Promise<ConnectorDto> {
  const existing = await findMicrosoftConnectorByEmail(userId, input.email);
  if (existing) {
    const err = new Error(`Microsoft account ${input.email} is already connected`) as Error & {
      status?: number;
    };
    err.status = 409;
    throw err;
  }

  const now = new Date();
  const [row] = await getDb()
    .insert(connectors)
    .values({
      id: newConnectorId(),
      userId,
      name: `Microsoft · ${input.email}`,
      type: "microsoft",
      description: "Read-only Outlook mail and Teams chat sync via Microsoft Graph.",
      baseUrl: null,
      authType: "oauth",
      enabled: true,
      syncStatus: "connected",
      settings: sealConnectorSettings({
        microsoftEmail: input.email,
        microsoftName: input.displayName ?? null,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        accessTokenExpiresAt: new Date(now.getTime() + input.expiresIn * 1000).toISOString(),
      }),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toDto(row!);
}

export async function writeMicrosoftConnectAudit(
  userId: string,
  connectorId: string,
  email: string,
): Promise<void> {
  await writeAuditLog({
    userId,
    action: "microsoft_connected",
    entityType: "connector",
    entityId: connectorId,
    metadata: { microsoftEmail: email },
  });
}

export async function findHomeyConnectorByEmail(
  userId: string,
  email: string,
): Promise<ConnectorDto | null> {
  const rows = await getDb()
    .select()
    .from(connectors)
    .where(and(eq(connectors.userId, userId), eq(connectors.type, "homey")));
  const needle = email.trim().toLowerCase();
  for (const row of rows) {
    const settings = openConnectorSettings(
      (row.settings ?? {}) as Record<string, unknown>,
    );
    const stored =
      typeof settings.homeyEmail === "string"
        ? settings.homeyEmail.toLowerCase()
        : "";
    if (stored === needle) return toDto(row);
  }
  return null;
}

export async function createHomeyConnectorForUser(
  userId: string,
  input: {
    email: string;
    displayName?: string | null;
    accessToken: string;
    refreshToken: string | null;
    expiresIn: number;
    homeyId?: string | null;
    homeyName?: string | null;
    remoteUrl?: string | null;
  },
): Promise<ConnectorDto & { webhookSecret?: string }> {
  const now = new Date();
  const label = input.homeyName ? `Homey · ${input.homeyName}` : `Homey · ${input.email}`;
  const existing = await findHomeyConnectorByEmail(userId, input.email);
  if (existing) {
    const rows = await getDb()
      .select()
      .from(connectors)
      .where(eq(connectors.id, existing.id))
      .limit(1);
    const row = rows[0]!;
    const prev = openConnectorSettings(
      (row.settings ?? {}) as Record<string, unknown>,
    );
    const webhookSecret =
      typeof prev.webhookSecret === "string" && prev.webhookSecret
        ? prev.webhookSecret
        : generateHomeyWebhookSecret();
    const [updated] = await getDb()
      .update(connectors)
      .set({
        name: label,
        baseUrl: input.remoteUrl ?? row.baseUrl,
        enabled: true,
        syncStatus: "connected",
        settings: sealConnectorSettings({
          ...prev,
          homeyEmail: input.email,
          homeyName: input.displayName ?? null,
          homeyId: input.homeyId ?? null,
          remoteUrl: input.remoteUrl ?? null,
          accessToken: input.accessToken,
          refreshToken: input.refreshToken ?? prev.refreshToken ?? null,
          accessTokenExpiresAt: new Date(
            now.getTime() + input.expiresIn * 1000,
          ).toISOString(),
          webhookSecret,
        }),
        updatedAt: now,
      })
      .where(eq(connectors.id, existing.id))
      .returning();
    return { ...toDto(updated!), webhookSecret };
  }

  const webhookSecret = generateHomeyWebhookSecret();
  const [row] = await getDb()
    .insert(connectors)
    .values({
      id: newConnectorId(),
      userId,
      name: label,
      type: "homey",
      description:
        "Homey Pro: smart-home device control via Ask and important Flow alerts via webhook.",
      baseUrl: input.remoteUrl ?? null,
      authType: "oauth",
      enabled: true,
      syncStatus: "connected",
      settings: sealConnectorSettings({
        homeyEmail: input.email,
        homeyName: input.displayName ?? null,
        homeyId: input.homeyId ?? null,
        remoteUrl: input.remoteUrl ?? null,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        accessTokenExpiresAt: new Date(now.getTime() + input.expiresIn * 1000).toISOString(),
        webhookSecret,
      }),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { ...toDto(row!), webhookSecret };
}

export async function writeHomeyConnectAudit(
  userId: string,
  connectorId: string,
  email: string,
): Promise<void> {
  await writeAuditLog({
    userId,
    action: "homey_connected",
    entityType: "connector",
    entityId: connectorId,
    metadata: { homeyEmail: email },
  });
}

async function findEvernoteConnectorByAccountId(
  userId: string,
  accountId: string,
): Promise<Connector | null> {
  const rows = await getDb()
    .select()
    .from(connectors)
    .where(and(eq(connectors.userId, userId), eq(connectors.type, "evernote")));
  for (const row of rows) {
    const settings = openConnectorSettings(
      (row.settings ?? {}) as Record<string, unknown>,
    );
    if (String(settings.evernoteAccountId ?? "") === accountId) return row;
  }
  return null;
}

export async function beginEvernoteMcpOAuthForUser(
  userId: string,
  oauthState: string,
): Promise<{ connectorId: string; authorizeUrl: string }> {
  const { beginEvernoteMcpOAuth } = await import(
    "../connectors/evernote-mcp"
  );
  const rows = await getDb()
    .select()
    .from(connectors)
    .where(
      and(eq(connectors.userId, userId), eq(connectors.type, "evernote")),
    );
  const existing =
    rows.find((row) => {
      const settings = openConnectorSettings(
        (row.settings ?? {}) as Record<string, unknown>,
      );
      return settings.authTransport === "mcp";
    }) ?? null;
  const existingSettings = existing
    ? openConnectorSettings(
        (existing.settings ?? {}) as Record<string, unknown>,
      )
    : undefined;
  const started = await beginEvernoteMcpOAuth(
    oauthState,
    existingSettings,
  );
  const now = new Date();
  const sealed = sealConnectorSettings({
    ...(existingSettings ?? {}),
    ...started.settings,
  });
  if (existing) {
    await getDb()
      .update(connectors)
      .set({
        name: "Evernote",
        description: "Read-only Evernote MCP sync for evidence-backed Ask.",
        baseUrl: "https://mcp.evernote.com/mcp",
        authType: "oauth2_dcr",
        settings: sealed,
        updatedAt: now,
      })
      .where(eq(connectors.id, existing.id));
    return { connectorId: existing.id, authorizeUrl: started.authorizeUrl };
  }
  const connectorId = newConnectorId();
  await getDb().insert(connectors).values({
    id: connectorId,
    userId,
    name: "Evernote",
    type: "evernote",
    description: "Read-only Evernote MCP sync for evidence-backed Ask.",
    baseUrl: "https://mcp.evernote.com/mcp",
    authType: "oauth2_dcr",
    enabled: false,
    syncStatus: "authorizing",
    settings: sealed,
    createdAt: now,
    updatedAt: now,
  });
  return { connectorId, authorizeUrl: started.authorizeUrl };
}

export async function finishEvernoteMcpOAuthForUser(
  userId: string,
  connectorId: string,
  oauthState: string,
  callbackParams: URLSearchParams,
): Promise<ConnectorDto> {
  const { finishEvernoteMcpOAuth, testEvernoteMcpConnection } = await import(
    "../connectors/evernote-mcp"
  );
  const rows = await getDb()
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.id, connectorId),
        eq(connectors.userId, userId),
        eq(connectors.type, "evernote"),
      ),
    )
    .limit(1);
  const connector = rows[0];
  if (!connector) throw new Error("Evernote MCP authorization connector not found");
  const settings = openConnectorSettings(
    (connector.settings ?? {}) as Record<string, unknown>,
  );
  if (
    settings.authTransport !== "mcp" ||
    settings.mcpOAuthState !== oauthState
  ) {
    throw new Error("Evernote MCP OAuth state mismatch");
  }
  const persistMcpState = async (next: Record<string, unknown>) => {
    await getDb()
      .update(connectors)
      .set({
        settings: sealConnectorSettings({ ...settings, ...next }),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connector.id));
  };
  const completed = await finishEvernoteMcpOAuth(
    settings,
    callbackParams,
    persistMcpState,
  );
  const checked = await testEvernoteMcpConnection(
    completed,
    persistMcpState,
  );
  const finalSettings = sealConnectorSettings({
    ...completed,
    ...checked.settings,
    mcpOAuthState: "",
    token: "",
  });
  const [updated] = await getDb()
    .update(connectors)
    .set({
      enabled: true,
      syncStatus: "connected",
      settings: finalSettings,
      updatedAt: new Date(),
    })
    .where(eq(connectors.id, connector.id))
    .returning();
  return toDto(updated!);
}

export async function createEvernoteConnectorForUser(
  userId: string,
  input: {
    accountId: string;
    accountName?: string | null;
    accountEmail?: string | null;
    accessToken: string;
    noteStoreUrl: string;
    webApiUrlPrefix?: string | null;
    expiresAt?: string | null;
    authType?: "oauth1" | "developer_token";
  },
): Promise<ConnectorDto> {
  const now = new Date();
  const identity =
    input.accountEmail?.trim() ||
    input.accountName?.trim() ||
    input.accountId;
  const settings = sealConnectorSettings({
    authTransport: "edam",
    evernoteAccountId: input.accountId,
    evernoteAccountName: input.accountName ?? null,
    evernoteAccountEmail: input.accountEmail ?? null,
    accessToken: input.accessToken,
    noteStoreUrl: input.noteStoreUrl,
    webApiUrlPrefix: input.webApiUrlPrefix ?? null,
    accessTokenExpiresAt: input.expiresAt ?? null,
  });
  const existing = await findEvernoteConnectorByAccountId(
    userId,
    input.accountId,
  );
  if (existing) {
    const [updated] = await getDb()
      .update(connectors)
      .set({
        name: `Evernote · ${identity}`,
        description: "Read-only Evernote notes synced for evidence-backed Ask.",
        baseUrl: input.noteStoreUrl,
        authType: input.authType ?? "oauth1",
        enabled: true,
        syncStatus: "connected",
        settings,
        updatedAt: now,
      })
      .where(eq(connectors.id, existing.id))
      .returning();
    return toDto(updated!);
  }

  const [row] = await getDb()
    .insert(connectors)
    .values({
      id: newConnectorId(),
      userId,
      name: `Evernote · ${identity}`,
      type: "evernote",
      description: "Read-only Evernote notes synced for evidence-backed Ask.",
      baseUrl: input.noteStoreUrl,
      authType: input.authType ?? "oauth1",
      enabled: true,
      syncStatus: "connected",
      settings,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toDto(row!);
}

export async function createEvernoteConnectorFromDeveloperTokenForUser(
  userId: string,
): Promise<ConnectorDto & { evernoteAccountId: string }> {
  const token = process.env.EVERNOTE_DEVELOPER_TOKEN?.trim();
  if (!token) {
    const error = new Error(
      "EVERNOTE_DEVELOPER_TOKEN is not configured on this server",
    ) as Error & { status?: number };
    error.status = 503;
    throw error;
  }
  const account = await inspectEvernoteToken(token);
  await testEvernoteReadAccess(account.accessToken, account.noteStoreUrl);
  const now = new Date();
  const identity =
    account.accountEmail?.trim() ||
    account.accountName?.trim() ||
    account.accountId;
  const sealedSettings = sealConnectorSettings({
    authTransport: "edam",
    evernoteAccountId: account.accountId,
    evernoteAccountName: account.accountName,
    evernoteAccountEmail: account.accountEmail,
    accessToken: account.accessToken,
    noteStoreUrl: account.noteStoreUrl,
    webApiUrlPrefix: account.webApiUrlPrefix,
    accessTokenExpiresAt: null,
  });
  const row = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`evernote-dev-token:${account.accountId}`}, 0))`,
    );
    const existingEvernote = await tx
      .select()
      .from(connectors)
      .where(eq(connectors.type, "evernote"));
    let sameUser: Connector | null = null;
    for (const existing of existingEvernote) {
      const settings = openConnectorSettings(
        (existing.settings ?? {}) as Record<string, unknown>,
      );
      if (settings.evernoteAccountId !== account.accountId) continue;
      if (existing.userId !== userId) {
        const error = new Error(
          "This single-user Evernote developer token is already linked to another Recall account",
        ) as Error & { status?: number };
        error.status = 409;
        throw error;
      }
      sameUser = existing;
    }
    if (sameUser) {
      const [updated] = await tx
        .update(connectors)
        .set({
          name: `Evernote · ${identity}`,
          description: "Read-only Evernote notes synced for evidence-backed Ask.",
          baseUrl: account.noteStoreUrl,
          authType: "developer_token",
          enabled: true,
          syncStatus: "connected",
          settings: sealedSettings,
          updatedAt: now,
        })
        .where(eq(connectors.id, sameUser.id))
        .returning();
      return updated!;
    }
    const [created] = await tx
      .insert(connectors)
      .values({
        id: newConnectorId(),
        userId,
        name: `Evernote · ${identity}`,
        type: "evernote",
        description: "Read-only Evernote notes synced for evidence-backed Ask.",
        baseUrl: account.noteStoreUrl,
        authType: "developer_token",
        enabled: true,
        syncStatus: "connected",
        settings: sealedSettings,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return created!;
  });
  const connector = toDto(row);
  return { ...connector, evernoteAccountId: account.accountId };
}

export async function testEvernoteConnectorForUser(
  userId: string,
  connectorId: string,
): Promise<{ ok: true; notebookCount: number; tagCount: number | null }> {
  const rows = await getDb()
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.id, connectorId),
        eq(connectors.userId, userId),
        eq(connectors.type, "evernote"),
      ),
    )
    .limit(1);
  const connector = rows[0];
  if (!connector) throw new Error("Evernote connector not found");
  const settings = openConnectorSettings(
    (connector.settings ?? {}) as Record<string, unknown>,
  );
  const accessToken =
    typeof settings.accessToken === "string" ? settings.accessToken : "";
  const noteStoreUrl =
    typeof settings.noteStoreUrl === "string" ? settings.noteStoreUrl : "";
  if (!accessToken) {
    throw new Error("Evernote connector is missing sealed credentials");
  }
  if (settings.authTransport === "mcp") {
    const { testEvernoteMcpConnection } = await import(
      "../connectors/evernote-mcp"
    );
    const persistMcpState = async (next: Record<string, unknown>) => {
      await getDb()
        .update(connectors)
        .set({
          settings: sealConnectorSettings({ ...settings, ...next }),
          updatedAt: new Date(),
        })
        .where(eq(connectors.id, connector.id));
    };
    const result = await testEvernoteMcpConnection(
      settings,
      persistMcpState,
    );
    await getDb()
      .update(connectors)
      .set({
        syncStatus: "connected",
        settings: sealConnectorSettings({
          ...settings,
          ...result.settings,
        }),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connector.id));
    return {
      ok: true,
      notebookCount: result.notebookCount,
      tagCount: result.tagCount,
    };
  }
  if (!noteStoreUrl) {
    throw new Error("Evernote EDAM connector is missing its NoteStore URL");
  }
  const result = await testEvernoteReadAccess(accessToken, noteStoreUrl);
  await getDb()
    .update(connectors)
    .set({ syncStatus: "connected", updatedAt: new Date() })
    .where(eq(connectors.id, connector.id));
  return { ok: true, ...result };
}

export async function writeEvernoteConnectAudit(
  userId: string,
  connectorId: string,
  accountId: string,
): Promise<void> {
  await writeAuditLog({
    userId,
    action: "evernote_connected",
    entityType: "connector",
    entityId: connectorId,
    metadata: { evernoteAccountId: accountId },
  });
}

/** Reveal webhook secret + URL for Homey Flow configuration (authenticated UI). */
export async function getHomeyWebhookInfoForUser(
  userId: string,
  connectorId: string,
  appOrigin: string,
): Promise<{ url: string; secret: string; connectorId: string } | null> {
  const rows = await getDb()
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.id, connectorId),
        eq(connectors.userId, userId),
        eq(connectors.type, "homey"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const settings = openConnectorSettings(
    (row.settings ?? {}) as Record<string, unknown>,
  );
  let secret =
    typeof settings.webhookSecret === "string" ? settings.webhookSecret : "";
  if (!secret) {
    secret = generateHomeyWebhookSecret();
    await getDb()
      .update(connectors)
      .set({
        settings: sealConnectorSettings({ ...settings, webhookSecret: secret }),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connectorId));
  }
  const base = appOrigin.replace(/\/$/, "");
  return {
    connectorId,
    secret,
    url: `${base}/api/webhooks/homey/${encodeURIComponent(connectorId)}`,
  };
}

export async function rotateHomeyWebhookSecretForUser(
  userId: string,
  connectorId: string,
  appOrigin: string,
): Promise<{ url: string; secret: string; connectorId: string } | null> {
  const rows = await getDb()
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.id, connectorId),
        eq(connectors.userId, userId),
        eq(connectors.type, "homey"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const settings = openConnectorSettings(
    (row.settings ?? {}) as Record<string, unknown>,
  );
  const secret = generateHomeyWebhookSecret();
  await getDb()
    .update(connectors)
    .set({
      settings: sealConnectorSettings({ ...settings, webhookSecret: secret }),
      updatedAt: new Date(),
    })
    .where(eq(connectors.id, connectorId));
  const base = appOrigin.replace(/\/$/, "");
  return {
    connectorId,
    secret,
    url: `${base}/api/webhooks/homey/${encodeURIComponent(connectorId)}`,
  };
}

export async function queryFinanceSummaryForUser(
  userId: string,
  connectorId: string,
  params?: { startDate?: string; endDate?: string; payee?: string },
): Promise<{
  total: number;
  transactionCount: number;
  transactions: FinanceTransaction[];
  evidenceNote: string;
}> {
  const conn = await getConnectorForUser(userId, connectorId);
  if (!conn || conn.type !== "finance_api" || !conn.baseUrl) {
    throw new Error("Finance connector not configured");
  }
  const apiKey = process.env.FINANCE_API_KEY ?? null;
  let transactions = await fetchFinanceTransactions(conn.baseUrl, apiKey, params);
  // Apply filters client-side too, so summaries are correct even if the
  // external API ignores the query params.
  if (params?.startDate) {
    transactions = transactions.filter((t) => (t.date ?? "") >= params.startDate!);
  }
  if (params?.endDate) {
    transactions = transactions.filter((t) => (t.date ?? "") <= params.endDate!);
  }
  if (params?.payee) {
    const needle = params.payee.toLowerCase();
    transactions = transactions.filter((t) => (t.payee ?? "").toLowerCase().includes(needle));
  }
  const total = sumTransactions(transactions);
  return {
    total,
    transactionCount: transactions.length,
    transactions,
    evidenceNote: `Total computed from ${transactions.length} transaction(s). External finance app is source of truth.`,
  };
}

/**
 * Idempotently ensure the finance connector exists when FINANCE_API_URL is
 * configured. Runs on every login so existing accounts get backfilled the
 * first time the finance app is connected.
 */
export async function ensureFinanceConnector(userId: string): Promise<void> {
  const financeUrl = process.env.FINANCE_API_URL?.trim();
  if (!financeUrl) return;
  const existing = await listConnectorsForUser(userId);
  const finance = existing.find((c) => c.type === "finance_api");
  if (finance) {
    // Keep the stored base URL in sync with the current configuration.
    if (finance.baseUrl !== financeUrl) {
      await getDb()
        .update(connectors)
        .set({ baseUrl: financeUrl, updatedAt: new Date() })
        .where(eq(connectors.id, finance.id));
    }
    return;
  }
  await createConnectorForUser(userId, {
    name: "Finance API",
    type: "finance_api",
    description: "Read-only connection to your MyFamilyBudget finance app.",
    baseUrl: financeUrl,
    authType: "bearer",
  });
}

export async function ensureDefaultConnectors(userId: string): Promise<void> {
  const existing = await listConnectorsForUser(userId);
  if (!existing.some((c) => c.type === "manual")) {
    await createConnectorForUser(userId, {
      name: "Manual Capture",
      type: "manual",
      description: "Paste and capture text directly into Recall.",
    });
  }
  await ensureFinanceConnector(userId);
}
