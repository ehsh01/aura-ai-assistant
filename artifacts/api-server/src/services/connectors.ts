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
  searchGmailMessages,
} from "../connectors/google";
import { manualConnector } from "../connectors/manual";
import type { RecallConnector } from "../connectors/types";
import { createEvidenceForUser } from "./evidence";
import { writeAuditLog } from "./audit";
import { openConnectorSettings, sealConnectorSettings } from "../lib/secret-box";

const CONNECTOR_IMPLS: Record<string, RecallConnector> = {
  manual: manualConnector,
  csv_import: csvImportConnector,
  finance_api: financeApiConnector,
  google: googleConnector,
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

export type LiveGmailHit = {
  mailbox: string;
  title: string;
  text: string;
  externalId: string;
  sourceUrl: string | null;
  sourceCreatedAt: string | null;
};

/**
 * Live-search Gmail across every connected Google account.
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

  const rows = await getDb()
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.userId, userId),
        eq(connectors.type, "google"),
        eq(connectors.enabled, true),
      ),
    );

  const hint = opts?.mailboxHint?.trim().toLowerCase() || null;
  const maxPer = opts?.maxPerMailbox ?? 15;
  const hits: LiveGmailHit[] = [];

  for (const row of rows) {
    const settings = openConnectorSettings(
      (row.settings ?? {}) as Record<string, unknown>,
    );
    const mailbox =
      typeof settings.googleEmail === "string"
        ? settings.googleEmail.trim().toLowerCase()
        : null;
    if (hint && mailbox && mailbox !== hint) continue;

    try {
      const { accessToken } = await ensureGoogleAccessToken(row);
      const found = await searchGmailMessages(accessToken, q, maxPer);
      for (const r of found) {
        const text = mailbox ? `Mailbox: ${mailbox}\n${r.recordText}` : r.recordText;
        hits.push({
          mailbox: mailbox ?? "unknown",
          title: r.recordTitle,
          text,
          externalId: r.externalId,
          sourceUrl: r.sourceUrl ?? null,
          sourceCreatedAt: r.sourceCreatedAt ?? null,
        });
      }
    } catch {
      // Skip mailboxes that fail auth/search; others may still succeed.
    }
  }

  if (opts?.personName?.trim()) {
    return rankLiveGmailHitsForPerson(hits, opts.personName);
  }
  return hits.sort((a, b) => {
    const ta = a.sourceCreatedAt ? Date.parse(a.sourceCreatedAt) : 0;
    const tb = b.sourceCreatedAt ? Date.parse(b.sourceCreatedAt) : 0;
    return tb - ta;
  });
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
export function buildGmailPersonQuery(personName: string): string | null {
  const who = cleanMailPersonName(personName);
  if (!who) return null;
  const tokens = who.split(/\s+/).filter(Boolean);
  const fromParts = [
    `from:(${who})`,
    ...tokens.map((t) => `from:${t}`),
    `"${who}"`,
    `(${who})`,
  ];
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

async function upsertSourceRecord(
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
    await getDb()
      .update(sourceRecords)
      .set({
        recordTitle: record.recordTitle ?? null,
        recordText: record.recordText ?? null,
        recordMetadata: record.recordMetadata ?? {},
        sourceUrl: record.sourceUrl ?? null,
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(sourceRecords.id, existing[0].id));
    return existing[0].id;
  }

  const id = newSourceRecordId();
  await getDb().insert(sourceRecords).values({
    id,
    userId,
    connectorId,
    externalId: record.externalId,
    recordType: record.recordType,
    recordTitle: record.recordTitle ?? null,
    recordText: record.recordText ?? null,
    recordMetadata: record.recordMetadata ?? {},
    sourceUrl: record.sourceUrl ?? null,
    sourceCreatedAt: record.sourceCreatedAt ? new Date(record.sourceCreatedAt) : null,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return id;
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
          await createEvidenceForUser(userId, {
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
