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

export type WaitingOnRecord = {
  id: string;
  person: string;
  personId: string | null;
  item: string;
  days: number;
  href: string;
  followUp: string;
  sourceType: "note" | "knowledge" | "task";
  evidenceText: string;
};

export async function listWaitingOn(): Promise<{ items: WaitingOnRecord[] }> {
  return apiFetch("/people/waiting-on");
}

export async function createWaitingFollowUp(waitingItemId: string): Promise<{
  task: { id: string; title: string };
  personId: string | null;
  waitingItemId: string;
}> {
  return apiFetch("/people/waiting-on/follow-up", {
    method: "POST",
    body: JSON.stringify({ waitingItemId }),
  });
}

export type ActivityRecord = {
  id: string;
  action: string;
  label: string;
  entityType: string | null;
  entityId: string | null;
  href: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export async function listActivity(params?: {
  limit?: number;
  action?: string;
}): Promise<{ items: ActivityRecord[] }> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.action) search.set("action", params.action);
  const q = search.toString();
  return apiFetch(q ? `/activity?${q}` : "/activity");
}

export async function createPerson(input: {
  displayName: string;
  email?: string | null;
  organization?: string | null;
}): Promise<PersonRecord> {
  return apiFetch("/people", { method: "POST", body: JSON.stringify(input) });
}

export async function updatePerson(
  personId: string,
  input: {
    displayName?: string;
    email?: string | null;
    phone?: string | null;
    organization?: string | null;
    role?: string | null;
    notes?: string | null;
  },
): Promise<PersonRecord> {
  return apiFetch(`/people/${encodeURIComponent(personId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export type PersonRelated = {
  person: PersonRecord;
  openTasks: { id: string; title: string; time: string | null }[];
  taggedNotes?: { id: string; title: string; preview: string }[];
  taggedKnowledge?: { id: string; title: string; itemType: string }[];
};

export async function getPersonRelated(personId: string): Promise<PersonRelated> {
  return apiFetch(`/people/${encodeURIComponent(personId)}/related`);
}

export async function fetchToday(): Promise<TodayResponse> {
  return apiFetch("/today");
}

export interface HomeBriefingItem {
  id: string;
  label: string;
  href: string;
}

export interface HomeBriefingResponse {
  date: string;
  briefing: {
    greeting: string;
    attentionCount: number;
    summary: string;
    critical: HomeBriefingItem[];
    waiting: HomeBriefingItem[];
    reminders: HomeBriefingItem[];
    suggestedAction: { label: string; href: string } | null;
    degraded: boolean;
    highlights: string[];
  };
  focus: {
    title: string;
    reason: string;
    estimatedTime: string;
    actionLabel: string;
    href: string;
  } | null;
  timeline: {
    id: string;
    title: string;
    bucket: "Now" | "Next" | "Today" | "This Week";
    kind: "task" | "reminder" | "note";
    href: string;
    meta?: string;
  }[];
  waiting: {
    id: string;
    person: string;
    personId?: string | null;
    item: string;
    days: number;
    href: string;
    followUp: string;
  }[];
  dontForget: HomeBriefingItem[];
  insights: {
    id: string;
    kind: "no-task" | "stale" | "follow-up" | "related";
    text: string;
    href?: string;
  }[];
  contextAreas: {
    id: string;
    name: string;
    count: number;
    href: string;
    accent: string;
  }[];
  finance: {
    total: number;
    transactionCount: number;
    rangeLabel: string;
    topPayee: { payee: string; total: number } | null;
    href: string;
    needsSync: boolean;
  } | null;
}

export async function fetchHome(): Promise<HomeBriefingResponse> {
  return apiFetch("/home");
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

export type FinanceTransaction = {
  id: string;
  date: string;
  amount: number;
  payee?: string | null;
  category?: string | null;
  notes?: string | null;
};

export type FinanceSummary = {
  total: number;
  transactionCount: number;
  transactions: FinanceTransaction[];
  evidenceNote: string;
};

export async function getFinanceSummary(
  connectorId: string,
  params?: { startDate?: string; endDate?: string; payee?: string },
): Promise<FinanceSummary> {
  const search = new URLSearchParams({ connectorId });
  if (params?.startDate) search.set("startDate", params.startDate);
  if (params?.endDate) search.set("endDate", params.endDate);
  if (params?.payee) search.set("payee", params.payee);
  return apiFetch(`/finance/summary?${search.toString()}`);
}

export type DocumentRecord = {
  id: string;
  fileName: string;
  fileType: string | null;
  storagePath: string | null;
  sourceCaptureId: string | null;
  extractedText: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  uploadedAt: string;
  createdAt: string;
  updatedAt: string;
};

export async function listDocuments(): Promise<{ documents: DocumentRecord[] }> {
  return apiFetch("/documents");
}

export async function createDocument(input: {
  fileName: string;
  fileType?: string | null;
  extractedText?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<DocumentRecord> {
  return apiFetch("/documents", { method: "POST", body: JSON.stringify(input) });
}

export type KnowledgeRecord = {
  id: string;
  title: string;
  content: string;
  itemType: string;
  tags: string[];
  projectId: string | null;
  primaryPersonId: string | null;
  primaryPersonName: string | null;
  sourceCaptureId: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listKnowledge(): Promise<{ items: KnowledgeRecord[] }> {
  return apiFetch("/knowledge");
}

export async function createKnowledge(input: {
  title: string;
  content?: string;
  itemType?: string;
  tags?: string[];
  primaryPersonId?: string | null;
}): Promise<KnowledgeRecord> {
  return apiFetch("/knowledge", { method: "POST", body: JSON.stringify(input) });
}

export async function updateKnowledge(
  itemId: string,
  input: {
    title?: string;
    content?: string;
    itemType?: string;
    tags?: string[];
    projectId?: string | null;
    primaryPersonId?: string | null;
  },
): Promise<KnowledgeRecord> {
  return apiFetch(`/knowledge/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function summarizeText(
  content: string,
  maxLength = 400,
): Promise<{ summary: string; degraded: boolean }> {
  return apiFetch("/ai/notes/summarize", {
    method: "POST",
    body: JSON.stringify({ content, maxLength }),
  });
}
