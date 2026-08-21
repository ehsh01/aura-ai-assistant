export type SourceOfTruthPolicy = "read_only_external" | "bidirectional" | "capture_only";

export type ConnectorType =
  | "manual"
  | "browser_extension"
  | "csv_import"
  | "finance_api"
  | "ticket_email"
  | "google"
  | "microsoft"
  | "homey"
  | "flipperforce";

export type NormalizedSourceRecord = {
  externalId: string;
  recordType: string;
  recordTitle?: string | null;
  recordText?: string | null;
  recordMetadata?: Record<string, unknown>;
  sourceUrl?: string | null;
  sourceCreatedAt?: string | null;
};

export type EvidenceInput = {
  claimType: string;
  evidenceText?: string | null;
  sourceRecordExternalId?: string | null;
  url?: string | null;
  rowNumber?: number | null;
};

export type SyncResult = {
  recordsFetched: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  errorMessage?: string | null;
};

export interface RecallConnector {
  id: string;
  type: ConnectorType;
  sourceOfTruth: SourceOfTruthPolicy;
  normalize(records: unknown[]): Promise<NormalizedSourceRecord[]>;
  mapEvidence(record: NormalizedSourceRecord): EvidenceInput[];
}
