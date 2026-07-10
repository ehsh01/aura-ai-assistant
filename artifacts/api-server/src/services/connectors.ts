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
import { manualConnector } from "../connectors/manual";
import type { RecallConnector } from "../connectors/types";
import { createEvidenceForUser } from "./evidence";
import { writeAuditLog } from "./audit";
import { sealConnectorSettings } from "../lib/secret-box";

const CONNECTOR_IMPLS: Record<string, RecallConnector> = {
  manual: manualConnector,
  csv_import: csvImportConnector,
  finance_api: financeApiConnector,
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
