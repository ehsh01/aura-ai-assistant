import { and, desc, eq, sql } from "drizzle-orm";
import { sourceRecords } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { classifyFinanceTransaction } from "./finance-classify";
import { formatMoney } from "./query-utils";

export type SubscriptionHeuristic = {
  payee: string;
  occurrenceCount: number;
  avgAmount: number;
  avgAmountFormatted: string;
  lastDate: string;
  cadenceDays: number | null;
  confidence: "high" | "medium" | "low";
};

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Detect recurring same-payee expenses (~monthly) from synced finance rows.
 */
export async function listSubscriptionHeuristicsForUser(
  userId: string,
  limit = 25,
): Promise<SubscriptionHeuristic[]> {
  const rows = await getDb()
    .select({
      recordMetadata: sourceRecords.recordMetadata,
      sourceCreatedAt: sourceRecords.sourceCreatedAt,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.recordType, "finance_transaction"),
      ),
    )
    .orderBy(desc(sql`coalesce(${sourceRecords.sourceCreatedAt}, ${sourceRecords.updatedAt})`))
    .limit(3000);

  const byPayee = new Map<string, { amounts: number[]; dates: string[] }>();

  for (const row of rows) {
    const meta = row.recordMetadata ?? {};
    const amount = typeof meta.amount === "number" ? meta.amount : Number(meta.amount);
    if (!Number.isFinite(amount)) continue;
    const payee = (typeof meta.payee === "string" && meta.payee.trim()) || "Unknown";
    const kind = classifyFinanceTransaction({
      amount,
      payee,
      category: typeof meta.category === "string" ? meta.category : null,
      type: typeof meta.type === "string" ? meta.type : null,
      transferSubtype:
        typeof meta.transferSubtype === "string" ? meta.transferSubtype : null,
      affectsSpending:
        typeof meta.affectsSpending === "boolean" || typeof meta.affectsSpending === "string"
          ? meta.affectsSpending
          : null,
    });
    if (kind !== "expense") continue;
    const date =
      (typeof meta.date === "string" && meta.date) ||
      (row.sourceCreatedAt ? row.sourceCreatedAt.toISOString().slice(0, 10) : "");
    if (!date) continue;
    const bucket = byPayee.get(payee) ?? { amounts: [], dates: [] };
    bucket.amounts.push(Math.abs(amount));
    bucket.dates.push(date);
    byPayee.set(payee, bucket);
  }

  const out: SubscriptionHeuristic[] = [];
  for (const [payee, bucket] of byPayee) {
    if (bucket.dates.length < 3) continue;
    const dates = [...bucket.dates].sort();
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const gap =
        (Date.parse(dates[i]!) - Date.parse(dates[i - 1]!)) / 86_400_000;
      if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
    }
    const cadence = median(gaps);
    if (cadence == null || cadence < 20 || cadence > 45) continue;

    const avg =
      bucket.amounts.reduce((s, n) => s + n, 0) / Math.max(1, bucket.amounts.length);
    const variance =
      bucket.amounts.reduce((s, n) => s + (n - avg) ** 2, 0) /
      Math.max(1, bucket.amounts.length);
    const relStd = Math.sqrt(variance) / Math.max(avg, 1);
    if (relStd > 0.35) continue;

    const confidence: SubscriptionHeuristic["confidence"] =
      bucket.dates.length >= 6 && relStd < 0.15
        ? "high"
        : bucket.dates.length >= 4
          ? "medium"
          : "low";

    out.push({
      payee,
      occurrenceCount: bucket.dates.length,
      avgAmount: Math.round(avg * 100) / 100,
      avgAmountFormatted: formatMoney(avg),
      lastDate: dates[dates.length - 1]!,
      cadenceDays: Math.round(cadence),
      confidence,
    });
  }

  out.sort((a, b) => b.occurrenceCount - a.occurrenceCount || b.avgAmount - a.avgAmount);
  return out.slice(0, limit);
}
