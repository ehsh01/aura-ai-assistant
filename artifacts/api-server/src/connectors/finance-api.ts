import type { EvidenceInput, NormalizedSourceRecord, RecallConnector } from "./types";

export type FinanceTransaction = {
  id: string;
  date: string;
  amount: number;
  payee?: string | null;
  category?: string | null;
  notes?: string | null;
  /** MyFamilyBudget: expense | income | transfer */
  type?: string | null;
  transferSubtype?: string | null;
  affectsSpending?: boolean | null;
  affectsIncome?: boolean | null;
  affectsCashFlow?: boolean | null;
};

export const financeApiConnector: RecallConnector = {
  id: "finance_api",
  type: "finance_api",
  sourceOfTruth: "read_only_external",
  async normalize(records: unknown[]): Promise<NormalizedSourceRecord[]> {
    return (records as FinanceTransaction[]).map((tx) => ({
      externalId: tx.id,
      recordType: "finance_transaction",
      recordTitle: tx.payee ?? `Transaction ${tx.id}`,
      recordText: `${tx.date} | ${tx.payee ?? "Unknown"} | $${tx.amount.toFixed(2)} | ${tx.category ?? ""}`,
      recordMetadata: tx as unknown as Record<string, unknown>,
      sourceCreatedAt: tx.date,
    }));
  },
  mapEvidence(record: NormalizedSourceRecord): EvidenceInput[] {
    return [
      {
        claimType: "amount_calculated_from",
        evidenceText: record.recordText ?? null,
        sourceRecordExternalId: record.externalId,
      },
    ];
  },
};

/**
 * Build the transactions endpoint URL, preserving the base path.
 *
 * A leading-slash URL argument (e.g. `new URL("/transactions", base)`) would
 * drop the "/api/v1" prefix, so we append to the trimmed base instead.
 */
export function buildFinanceUrl(
  baseUrl: string,
  params?: { startDate?: string; endDate?: string },
): string {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/transactions`);
  if (params?.startDate) url.searchParams.set("startDate", params.startDate);
  if (params?.endDate) url.searchParams.set("endDate", params.endDate);
  return url.toString();
}

export async function fetchFinanceTransactions(
  baseUrl: string,
  apiKey: string | null,
  params?: { startDate?: string; endDate?: string },
): Promise<FinanceTransaction[]> {
  const url = buildFinanceUrl(baseUrl, params);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  // Bounded: a hung upstream must not hold the sync (and its DB work) open
  // for the ~2min socket default on a shared connection-capped cluster.
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`Finance API error: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as
    | FinanceTransaction[]
    | { data?: FinanceTransaction[]; transactions?: FinanceTransaction[] };
  if (Array.isArray(data)) return data;
  return data.data ?? data.transactions ?? [];
}

export function sumTransactions(transactions: FinanceTransaction[]): number {
  const cents = transactions.reduce((sum, tx) => sum + Math.round(tx.amount * 100), 0);
  return cents / 100;
}
