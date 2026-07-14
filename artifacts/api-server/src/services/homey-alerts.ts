import { and, desc, eq, gte, sql } from "drizzle-orm";
import { sourceRecords } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import {
  normalizeHomeyAlert,
  normalizeSeverity,
  type HomeyAlertPayload,
  type HomeyAlertSeverity,
} from "../connectors/homey";
import { upsertSourceRecord } from "./connectors";
import { upsertEvidenceForSourceRecord } from "./evidence";

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const QUIET_HOURS_START = 22; // 22:00 local
const QUIET_HOURS_END = 7; // 07:00 local

export type HomeyAlertDto = {
  id: string;
  title: string;
  severity: HomeyAlertSeverity;
  kind: string;
  deviceName: string | null;
  message: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
};

function recallTimezone(): string {
  return process.env.RECALL_TIMEZONE?.trim() || "America/New_York";
}

/** Quiet hours suppress info/warn alerts; emergencies always pass. */
export function isHomeyQuietHours(now: Date = new Date()): boolean {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: recallTimezone(),
        hour: "numeric",
        hour12: false,
      }).format(now),
    );
    if (Number.isNaN(hour)) return false;
    return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
  } catch {
    const hour = now.getHours();
    return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
  }
}

export function shouldSurfaceHomeyAlert(
  severity: HomeyAlertSeverity,
  now: Date = new Date(),
): boolean {
  if (severity === "emergency") return true;
  if (isHomeyQuietHours(now) && severity === "info") return false;
  // warn during quiet hours still surfaces (home security), info does not
  if (isHomeyQuietHours(now) && severity === "warn") return true;
  return true;
}

function extractMessage(recordText: string | null | undefined): string | null {
  if (!recordText) return null;
  const m = recordText.match(/^message:\s*(.+)$/im);
  return m?.[1]?.trim() || null;
}

/**
 * Ingest a Homey Flow webhook alert. Dedupes same device+kind within 10 minutes.
 * Returns null when filtered (quiet hours info) or duplicate.
 */
export async function ingestHomeyAlertForUser(
  userId: string,
  connectorId: string,
  payload: HomeyAlertPayload,
): Promise<{ recordId: string; deduped: boolean; filtered: boolean } | null> {
  const severity = normalizeSeverity(payload.severity);
  if (!shouldSurfaceHomeyAlert(severity)) {
    return { recordId: "", deduped: false, filtered: true };
  }

  const kind = (payload.kind ?? "other").toString().trim().toLowerCase() || "other";
  const deviceName = (payload.deviceName ?? "").toString().trim().toLowerCase();
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);

  const recent = await getDb()
    .select({
      id: sourceRecords.id,
      metadata: sourceRecords.recordMetadata,
      title: sourceRecords.recordTitle,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.connectorId, connectorId),
        eq(sourceRecords.recordType, "homey_alert"),
        gte(sourceRecords.createdAt, since),
      ),
    )
    .orderBy(desc(sourceRecords.createdAt))
    .limit(40);

  for (const row of recent) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const rowKind = String(meta.kind ?? "").toLowerCase();
    const rowDevice = String(meta.deviceName ?? "").toLowerCase();
    const rowSeverity = String(meta.severity ?? "").toLowerCase();
    if (
      rowKind === kind &&
      rowSeverity === severity &&
      (deviceName ? rowDevice === deviceName : (row.title ?? "") === (payload.title ?? ""))
    ) {
      return { recordId: row.id, deduped: true, filtered: false };
    }
  }

  const normalized = normalizeHomeyAlert(payload, { connectorId });
  const sourceRecordId = await upsertSourceRecord(userId, connectorId, {
    externalId: normalized.externalId,
    recordType: normalized.recordType,
    recordTitle: normalized.recordTitle,
    recordText: normalized.recordText,
    recordMetadata: normalized.metadata ?? {},
    sourceUrl: null,
    sourceCreatedAt: normalized.sourceCreatedAt ?? null,
  });

  await upsertEvidenceForSourceRecord(userId, {
    entityType: "source_record",
    entityId: sourceRecordId,
    claimType: "summary_based_on",
    sourceRecordId,
    evidenceText: normalized.recordText,
    url: null,
    rowNumber: null,
  });

  return { recordId: sourceRecordId, deduped: false, filtered: false };
}

/** Recent unacknowledged Homey alerts for Today / Urgency. */
export async function listOpenHomeyAlertsForUser(
  userId: string,
  opts?: { limit?: number; hours?: number },
): Promise<HomeyAlertDto[]> {
  const limit = opts?.limit ?? 12;
  const hours = opts?.hours ?? 48;
  const since = new Date(Date.now() - hours * 3600_000);

  const rows = await getDb()
    .select({
      id: sourceRecords.id,
      title: sourceRecords.recordTitle,
      text: sourceRecords.recordText,
      metadata: sourceRecords.recordMetadata,
      createdAt: sourceRecords.createdAt,
      sourceCreatedAt: sourceRecords.sourceCreatedAt,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.recordType, "homey_alert"),
        gte(
          sql`coalesce(${sourceRecords.sourceCreatedAt}, ${sourceRecords.createdAt})`,
          since,
        ),
      ),
    )
    .orderBy(
      desc(sql`coalesce(${sourceRecords.sourceCreatedAt}, ${sourceRecords.createdAt})`),
    )
    .limit(80);

  const out: HomeyAlertDto[] = [];
  for (const row of rows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    if (meta.acknowledgedAt) continue;
    const severity = normalizeSeverity(meta.severity);
    if (!shouldSurfaceHomeyAlert(severity)) continue;
    out.push({
      id: row.id,
      title: row.title || "Homey alert",
      severity,
      kind: String(meta.kind ?? "other"),
      deviceName: typeof meta.deviceName === "string" ? meta.deviceName : null,
      message: extractMessage(row.text),
      createdAt: (row.sourceCreatedAt ?? row.createdAt).toISOString(),
      acknowledgedAt: null,
    });
    if (out.length >= limit) break;
  }

  // Emergencies first, then warn, then info; within band newest first (already ordered).
  const rank = (s: HomeyAlertSeverity) =>
    s === "emergency" ? 0 : s === "warn" ? 1 : 2;
  return out.sort(
    (a, b) =>
      rank(a.severity) - rank(b.severity) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export async function acknowledgeHomeyAlertForUser(
  userId: string,
  alertId: string,
): Promise<boolean> {
  const rows = await getDb()
    .select()
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.id, alertId),
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.recordType, "homey_alert"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return false;
  const meta = {
    ...((row.recordMetadata ?? {}) as Record<string, unknown>),
    acknowledgedAt: new Date().toISOString(),
  };
  await getDb()
    .update(sourceRecords)
    .set({ recordMetadata: meta, updatedAt: new Date() })
    .where(eq(sourceRecords.id, alertId));
  return true;
}
