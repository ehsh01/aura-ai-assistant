import type { EvidenceInput, NormalizedSourceRecord, RecallConnector } from "./types";

export type CsvRow = Record<string, string>;

export const csvImportConnector: RecallConnector = {
  id: "csv_import",
  type: "csv_import",
  sourceOfTruth: "read_only_external",
  async normalize(records: unknown[]): Promise<NormalizedSourceRecord[]> {
    return (records as CsvRow[]).map((row, index) => {
      const title = row.title ?? row.vendor ?? row.name ?? `Row ${index + 1}`;
      const text = Object.entries(row)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      return {
        externalId: row.id ?? row.external_id ?? `csv-row-${index + 1}`,
        recordType: row.record_type ?? "csv_row",
        recordTitle: title,
        recordText: text,
        recordMetadata: row,
        sourceCreatedAt: row.date ?? null,
      };
    });
  },
  mapEvidence(record: NormalizedSourceRecord): EvidenceInput[] {
    const rowNumber =
      typeof record.recordMetadata?.rowNumber === "number"
        ? record.recordMetadata.rowNumber
        : null;
    return [
      {
        claimType: "amount_calculated_from",
        evidenceText: record.recordText ?? null,
        sourceRecordExternalId: record.externalId,
        rowNumber,
      },
    ];
  },
};

/** Parse simple CSV text (header row + data). Production CSV import can grow field mapping UI later. */
export function parseCsvText(csv: string): CsvRow[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(",").map((h) => h.trim());
  return lines.slice(1).map((line, rowIndex) => {
    const values = line.split(",");
    const row: CsvRow = { rowNumber: String(rowIndex + 2) };
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? "").trim();
    });
    return row;
  });
}
