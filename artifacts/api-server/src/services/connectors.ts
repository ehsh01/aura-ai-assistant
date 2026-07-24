import { and, desc, eq } from "drizzle-orm";
import { connectors, sourceRecords, syncRuns, type Connector } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newConnectorId, newSourceRecordId, newSyncRunId } from "../lib/recall-format";
import { csvImportConnector, parseCsvText } from "../connectors/csv-import";
import {
  fetchFinanceTransactions,
  financeApiConnector,
  sumTransactions,
  type FinanceTransaction,
} from "../connectors/finance-api";
import {
  fetchGoogleBundle,
  googleConnector,
  refreshGoogleAccessToken,
  searchDriveFiles,
  searchGmailMessages,
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
import { upsertEvidenceForSourceRecord } from "./evidence";
import { writeAuditLog } from "./audit";
import { warmEntityEmbedding } from "./embedding-cache";
import { heuristicDigest, withSourceDigest } from "./digests";
import { openConnectorSettings, sealConnectorSettings } from "../lib/secret-box";
import { matchHomeyName, type HomeyAskPlan } from "./nl-homey-query";

const CONNECTOR_IMPLS: Record<string, RecallConnector> = {
  manual: manualConnector,
  csv_import: csvImportConnector,
  finance_api: financeApiConnector,
  google: googleConnector,
  microsoft: microsoftConnector,
  ticket_email: ticketEmailConnector,
  homey: homeyConnector,
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

/** Resolve a fresh Google access token for a connector row. */
async function ensureGoogleAccessToken(conn: Connector): Promise<{
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
    typeof settings.googleEmail === "string"
      ? settings.googleEmail.trim().toLowerCase()
      : null;

  if (!refreshToken && !accessToken) {
    throw new Error("Google connector is missing OAuth tokens — reconnect Google");
  }

  const needsRefresh = !accessToken || !expiresAt || expiresAt < Date.now() + 60_000;
  if (needsRefresh) {
    if (!refreshToken) {
      throw new Error(
        "Google access token expired and no refresh token is stored — reconnect Google",
      );
    }
    const refreshed = await refreshGoogleAccessToken(refreshToken);
    accessToken = refreshed.accessToken;
    const nextSettings = sealConnectorSettings({
      ...settings,
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
      refreshToken,
    });
    await getDb()
      .update(connectors)
      .set({ settings: nextSettings, updatedAt: new Date() })
      .where(eq(connectors.id, conn.id));
  }

  return { accessToken: accessToken!, mailbox };
}

/** Resolve a fresh Google access token and fetch the sync bundle. */
async function fetchGoogleRecordsForConnector(conn: Connector): Promise<unknown[]> {
  const { accessToken, mailbox } = await ensureGoogleAccessToken(conn);
  return fetchGoogleBundle(accessToken, mailbox);
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
        } catch {
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
      } catch {
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
    const settings = (row.settings ?? {}) as Record<string, unknown>;
    const stored =
      typeof settings.googleEmail === "string" ? settings.googleEmail.toLowerCase() : "";
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
  },
): Promise<ConnectorDto> {
  const existing = await findGoogleConnectorByEmail(userId, input.email);
  if (existing) {
    const err = new Error(`Google account ${input.email} is already connected`) as Error & {
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
        accessTokenExpiresAt: new Date(now.getTime() + input.expiresIn * 1000).toISOString(),
      }),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toDto(row!);
}

export async function upsertSourceRecord(
  userId: string,
  connectorId: string,
  record: Awaited<ReturnType<RecallConnector["normalize"]>>[number],
): Promise<string> {
  const existing = await getDb()
    .select()
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
    const meta = withSourceDigest(
      (record.recordMetadata ?? {}) as Record<string, unknown>,
      heuristicDigest(record.recordTitle ?? "", record.recordText ?? "", 400),
    );
    await getDb()
      .update(sourceRecords)
      .set({
        recordTitle: record.recordTitle ?? null,
        recordText: record.recordText ?? null,
        recordMetadata: meta,
        sourceUrl: record.sourceUrl ?? null,
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(sourceRecords.id, existing[0].id));
    return existing[0].id;
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
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return id;
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

export async function syncConnectorForUser(
  userId: string,
  connectorId: string,
  payload?: { csvText?: string; records?: unknown[] },
): Promise<{ syncRunId: string; result: { recordsFetched: number; recordsCreated: number; recordsUpdated: number; recordsFailed: number } }> {
  const connRows = await getDb()
    .select()
    .from(connectors)
    .where(and(eq(connectors.id, connectorId), eq(connectors.userId, userId)))
    .limit(1);
  const conn = connRows[0];
  if (!conn) throw new Error("Connector not found");

  const impl = CONNECTOR_IMPLS[conn.type];
  if (!impl) throw new Error(`Unsupported connector type: ${conn.type}`);

  const syncRunId = newSyncRunId();
  const started = new Date();
  await getDb().insert(syncRuns).values({
    id: syncRunId,
    userId,
    connectorId,
    status: "running",
    startedAt: started,
    recordsFetched: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsFailed: 0,
    metadata: {},
  });

  let recordsFetched = 0;
  let recordsCreated = 0;
  let recordsUpdated = 0;
  let recordsFailed = 0;
  let errorMessage: string | null = null;

  try {
    let rawRecords: unknown[] = payload?.records ?? [];
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

    const normalized = await impl.normalize(rawRecords);
    recordsFetched = normalized.length;

    for (const record of normalized) {
      try {
        const existingBefore = await getDb()
          .select({ id: sourceRecords.id })
          .from(sourceRecords)
          .where(
            and(
              eq(sourceRecords.connectorId, connectorId),
              eq(sourceRecords.externalId, record.externalId),
            ),
          )
          .limit(1);

        const sourceRecordId = await upsertSourceRecord(userId, connectorId, record);
        if (existingBefore[0]) recordsUpdated++;
        else recordsCreated++;

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
      } catch {
        recordsFailed++;
      }
    }

    if (conn.type === "homey") {
      void warmRecentSourceEmbeddings(userId, connectorId, {
        recordType: "homey_device",
        fallbackTitle: "Homey device",
      }).catch(() => undefined);
    } else if (conn.type === "google" || conn.type === "microsoft") {
      // Warm freshly synced mail/calendar/drive/contact records across types.
      void warmRecentSourceEmbeddings(userId, connectorId, { limit: 60 }).catch(
        () => undefined,
      );
    }

    if (conn.type === "google") {
      // Promote calendar events + extract high-confidence Gmail deadlines.
      void (async () => {
        try {
          const { enqueueJob, JOB_TYPE_ATTENTION_SCAN } = await import("./job-queue");
          const { nudgeJobWorker } = await import("./job-worker");
          await enqueueJob({
            userId,
            type: JOB_TYPE_ATTENTION_SCAN,
            payload: { connectorId },
            id: `attn-scan-${userId}-${connectorId}-${Math.floor(Date.now() / 300_000)}`,
          });
          nudgeJobWorker();
        } catch {
          /* non-fatal */
        }
      })();
    }

    await getDb()
      .update(connectors)
      .set({
        syncStatus: recordsFailed > 0 ? "partial_success" : "connected",
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connectorId));

    await getDb()
      .update(syncRuns)
      .set({
        status: recordsFailed > 0 ? "partial_success" : "complete",
        completedAt: new Date(),
        recordsFetched,
        recordsCreated,
        recordsUpdated,
        recordsFailed,
      })
      .where(eq(syncRuns.id, syncRunId));
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Sync failed";
    await getDb()
      .update(connectors)
      .set({ syncStatus: "sync_failed", updatedAt: new Date() })
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
        recordsFailed,
      })
      .where(eq(syncRuns.id, syncRunId));
    throw err;
  }

  await writeAuditLog({
    userId,
    action: "connector_sync",
    entityType: "connector",
    entityId: connectorId,
    metadata: { syncRunId, recordsFetched, recordsCreated },
  });

  return {
    syncRunId,
    result: { recordsFetched, recordsCreated, recordsUpdated, recordsFailed },
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
