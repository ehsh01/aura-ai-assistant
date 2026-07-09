import { getStoredToken } from "./auth-storage";

const API_BASE = "/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init?.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export type EvidenceRecord = {
  id: string;
  entityType: string;
  entityId: string;
  claimType: string;
  sourceCaptureId: string | null;
  sourceRecordId: string | null;
  evidenceText: string | null;
  evidenceMetadata: Record<string, unknown>;
  fileName: string | null;
  url: string | null;
  createdAt: string;
};

export type PersonRecord = {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  organization: string | null;
  department: string | null;
  role: string | null;
  notes: string | null;
};

export type TodayResponse = {
  mustDo: { id: string; kind: string; title: string; reason: string; href: string }[];
  overdue: { id: string; kind: string; title: string; reason: string; href: string }[];
  waiting: { id: string; kind: string; title: string; reason: string; href: string }[];
  inbox: { id: string; kind: string; title: string; reason: string; href: string }[];
  suggestedFocus: { id: string; kind: string; title: string; reason: string; href: string } | null;
};

export async function ingestCapture(input: {
  rawText: string;
  sourceType?: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
}): Promise<{ id: string; jobId: string }> {
  return apiFetch("/captures", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listEntityEvidence(
  entityType: string,
  entityId: string,
): Promise<{ items: EvidenceRecord[] }> {
  return apiFetch(`/entities/${entityType}/${entityId}/evidence`);
}

export async function listPeople(): Promise<{ people: PersonRecord[] }> {
  return apiFetch("/people");
}

export async function createPerson(input: {
  displayName: string;
  email?: string | null;
  organization?: string | null;
}): Promise<PersonRecord> {
  return apiFetch("/people", { method: "POST", body: JSON.stringify(input) });
}

export async function fetchToday(): Promise<TodayResponse> {
  return apiFetch("/today");
}

export async function queryRecall(question: string): Promise<{
  answer: string;
  confidence: number;
  caveats: string | null;
  evidence: EvidenceRecord[];
  relatedRecords: { entityType: string; entityId: string; title: string }[];
  suggestedNextAction: string | null;
}> {
  return apiFetch("/ai/query", {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

export async function listConnectors(): Promise<{
  connectors: {
    id: string;
    name: string;
    type: string;
    syncStatus: string;
    enabled: boolean;
  }[];
}> {
  return apiFetch("/connectors");
}

export async function syncConnector(
  connectorId: string,
  body?: { csvText?: string },
): Promise<{ syncRunId: string; result: Record<string, number> }> {
  return apiFetch(`/connectors/${connectorId}/sync`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}
