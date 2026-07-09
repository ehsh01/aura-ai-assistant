import type { EvidenceInput, NormalizedSourceRecord, RecallConnector } from "./types";

export const manualConnector: RecallConnector = {
  id: "manual",
  type: "manual",
  sourceOfTruth: "capture_only",
  async normalize(records: unknown[]): Promise<NormalizedSourceRecord[]> {
    return records.map((r, i) => {
      const row = r as { text?: string; title?: string };
      return {
        externalId: `manual-${Date.now()}-${i}`,
        recordType: "manual_capture",
        recordTitle: row.title ?? null,
        recordText: row.text ?? String(r),
      };
    });
  },
  mapEvidence(record: NormalizedSourceRecord): EvidenceInput[] {
    return [
      {
        claimType: "summary_based_on",
        evidenceText: record.recordText ?? null,
      },
    ];
  },
};
