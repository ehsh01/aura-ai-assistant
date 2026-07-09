import type { EvidenceInput, NormalizedSourceRecord, RecallConnector } from "./types";

export type FinanceTransaction = {
  id: string;
  date: string;
  amount: number;
  payee?: string | null;
  category?: string | null;
  notes?: string | null;
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

export async function fetchFinanceTransactions(
  baseUrl: string,
  apiKey: string | null,
  params?: { startDate?: string; endDate?: string },
): Promise<FinanceTransaction[]> {
  const url = new URL("/transactions", baseUrl.replace(/\/$/, ""));
  if (params?.startDate) url.searchParams.set("startDate", params.startDate);
  if (params?.endDate) url.searchParams.set("endDate", params.endDate);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(url.toString(), { headers });
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
  return transactions.reduce((sum, tx) => sum + tx.amount, 0);
}
