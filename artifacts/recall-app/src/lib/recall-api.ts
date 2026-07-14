const API_BASE = "/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
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

export type VehicleRecord = {
  id: string;
  displayName: string;
  year: string | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  licensePlate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HomeRecord = {
  id: string;
  displayName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WarrantyRecord = {
  id: string;
  title: string;
  subjectType: "vehicle" | "home" | "other";
  subjectId: string | null;
  subjectName: string | null;
  provider: string | null;
  expiresAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

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

/** Merge `mergeId` into `keepId` (keepId is the surviving person). */
export async function mergePeople(
  keepId: string,
  mergeId: string,
): Promise<{ kept: PersonRecord; mergedId: string }> {
  return apiFetch(`/people/${encodeURIComponent(keepId)}/merge`, {
    method: "POST",
    body: JSON.stringify({ mergeId }),
  });
}

export type PersonRelated = {
  person: PersonRecord;
  openTasks: { id: string; title: string; time: string | null }[];
  taggedNotes?: { id: string; title: string; preview: string }[];
  taggedKnowledge?: { id: string; title: string; itemType: string }[];
  linkedMemories?: { id: string; title: string; domain: string }[];
};

export async function getPersonRelated(personId: string): Promise<PersonRelated> {
  return apiFetch(`/people/${encodeURIComponent(personId)}/related`);
}

export type TimelineItem = {
  entityType: string;
  entityId: string;
  title: string;
  subtitle?: string;
  at: string;
  href: string;
};

export async function getPersonTimeline(
  personId: string,
): Promise<{ person: PersonRecord; items: TimelineItem[] }> {
  return apiFetch(`/people/${encodeURIComponent(personId)}/timeline`);
}

export async function getProjectTimeline(
  projectId: string,
): Promise<{ projectId: string; items: TimelineItem[] }> {
  return apiFetch(`/projects/${encodeURIComponent(projectId)}/timeline`);
}

export async function listVehicles(): Promise<{ vehicles: VehicleRecord[] }> {
  return apiFetch("/vehicles");
}

export async function createVehicle(input: {
  displayName: string;
  year?: string | null;
  make?: string | null;
  model?: string | null;
  vin?: string | null;
  licensePlate?: string | null;
  notes?: string | null;
}): Promise<VehicleRecord> {
  return apiFetch("/vehicles", { method: "POST", body: JSON.stringify(input) });
}

export async function updateVehicle(
  vehicleId: string,
  input: Partial<{
    displayName: string;
    year: string | null;
    make: string | null;
    model: string | null;
    vin: string | null;
    licensePlate: string | null;
    notes: string | null;
  }>,
): Promise<VehicleRecord> {
  return apiFetch(`/vehicles/${encodeURIComponent(vehicleId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteVehicle(vehicleId: string): Promise<void> {
  await apiFetch(`/vehicles/${encodeURIComponent(vehicleId)}`, { method: "DELETE" });
}

export async function listHomes(): Promise<{ homes: HomeRecord[] }> {
  return apiFetch("/homes");
}

export async function createHome(input: {
  displayName: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  notes?: string | null;
}): Promise<HomeRecord> {
  return apiFetch("/homes", { method: "POST", body: JSON.stringify(input) });
}

export async function updateHome(
  homeId: string,
  input: Partial<{
    displayName: string;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    notes: string | null;
  }>,
): Promise<HomeRecord> {
  return apiFetch(`/homes/${encodeURIComponent(homeId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteHome(homeId: string): Promise<void> {
  await apiFetch(`/homes/${encodeURIComponent(homeId)}`, { method: "DELETE" });
}

export async function listWarranties(): Promise<{ warranties: WarrantyRecord[] }> {
  return apiFetch("/warranties");
}

export async function createWarranty(input: {
  title: string;
  subjectType?: "vehicle" | "home" | "other";
  subjectId?: string | null;
  provider?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
}): Promise<WarrantyRecord> {
  return apiFetch("/warranties", { method: "POST", body: JSON.stringify(input) });
}

export async function updateWarranty(
  warrantyId: string,
  input: Partial<{
    title: string;
    subjectType: "vehicle" | "home" | "other";
    subjectId: string | null;
    provider: string | null;
    expiresAt: string | null;
    notes: string | null;
  }>,
): Promise<WarrantyRecord> {
  return apiFetch(`/warranties/${encodeURIComponent(warrantyId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteWarranty(warrantyId: string): Promise<void> {
  await apiFetch(`/warranties/${encodeURIComponent(warrantyId)}`, { method: "DELETE" });
}

export type OrganizationRecord = {
  id: string;
  displayName: string;
  orgType: "vendor" | "contractor" | "employer" | "agency" | "other";
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceRecord = {
  id: string;
  title: string;
  organizationId: string | null;
  organizationName: string | null;
  amountCents: number | null;
  currency: string;
  status: "open" | "paid" | "void" | "other";
  invoiceDate: string | null;
  dueDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listOrganizations(): Promise<{ organizations: OrganizationRecord[] }> {
  return apiFetch("/organizations");
}

export async function createOrganization(input: {
  displayName: string;
  orgType?: OrganizationRecord["orgType"];
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
}): Promise<OrganizationRecord> {
  return apiFetch("/organizations", { method: "POST", body: JSON.stringify(input) });
}

export async function updateOrganization(
  organizationId: string,
  input: Partial<{
    displayName: string;
    orgType: OrganizationRecord["orgType"];
    email: string | null;
    phone: string | null;
    website: string | null;
    notes: string | null;
  }>,
): Promise<OrganizationRecord> {
  return apiFetch(`/organizations/${encodeURIComponent(organizationId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteOrganization(organizationId: string): Promise<void> {
  await apiFetch(`/organizations/${encodeURIComponent(organizationId)}`, {
    method: "DELETE",
  });
}

export async function listInvoices(): Promise<{ invoices: InvoiceRecord[] }> {
  return apiFetch("/invoices");
}

export async function createInvoice(input: {
  title: string;
  organizationId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  status?: InvoiceRecord["status"];
  invoiceDate?: string | null;
  dueDate?: string | null;
  notes?: string | null;
}): Promise<InvoiceRecord> {
  return apiFetch("/invoices", { method: "POST", body: JSON.stringify(input) });
}

export async function updateInvoice(
  invoiceId: string,
  input: Partial<{
    title: string;
    organizationId: string | null;
    amountCents: number | null;
    currency: string | null;
    status: InvoiceRecord["status"];
    invoiceDate: string | null;
    dueDate: string | null;
    notes: string | null;
  }>,
): Promise<InvoiceRecord> {
  return apiFetch(`/invoices/${encodeURIComponent(invoiceId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteInvoice(invoiceId: string): Promise<void> {
  await apiFetch(`/invoices/${encodeURIComponent(invoiceId)}`, { method: "DELETE" });
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
    kind:
      | "no-task"
      | "stale"
      | "follow-up"
      | "related"
      | "recurring-payment"
      | "project-change"
      | "warranty"
      | "invoice-due";
    text: string;
    href?: string;
    evidence?: string;
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

/** Pull latest MyFamilyBudget transactions into Recall (app open / manual refresh). */
export async function refreshFinance(): Promise<{ ok: boolean; synced: boolean; skipped: boolean }> {
  return apiFetch("/finance/refresh", { method: "POST", body: "{}" });
}

export async function queryRecall(
  question: string,
  options?: { threadId?: string | null },
): Promise<{
  answer: string;
  confidence: number;
  caveats: string | null;
  evidence: EvidenceRecord[];
  relatedRecords: { entityType: string; entityId: string; title: string }[];
  suggestedNextAction: string | null;
  threadId: string | null;
  privacy?: {
    model: string | null;
    dataLeftDevice: boolean;
    categoriesSent: string[];
  };
}> {
  return apiFetch("/ai/query", {
    method: "POST",
    body: JSON.stringify({
      question,
      threadId: options?.threadId ?? undefined,
    }),
  });
}

export type AskThreadRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AskMessageRecord = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export async function listAskThreads(): Promise<{ threads: AskThreadRecord[] }> {
  return apiFetch("/ai/threads");
}

export async function createAskThread(): Promise<{
  thread: AskThreadRecord;
  messages: AskMessageRecord[];
}> {
  return apiFetch("/ai/threads", { method: "POST", body: "{}" });
}

export async function getAskThread(
  threadId: string,
): Promise<{ thread: AskThreadRecord; messages: AskMessageRecord[] }> {
  return apiFetch(`/ai/threads/${encodeURIComponent(threadId)}`);
}

const ASK_THREAD_KEY = "recall_ask_thread_id";

export function getStoredAskThreadId(): string | null {
  try {
    return localStorage.getItem(ASK_THREAD_KEY);
  } catch {
    return null;
  }
}

export function setStoredAskThreadId(threadId: string | null): void {
  try {
    if (!threadId) localStorage.removeItem(ASK_THREAD_KEY);
    else localStorage.setItem(ASK_THREAD_KEY, threadId);
  } catch {
    // ignore
  }
}

export async function listConnectors(): Promise<{
  connectors: {
    id: string;
    name: string;
    type: string;
    syncStatus: string;
    enabled: boolean;
  }[];
  googleOAuthConfigured?: boolean;
}> {
  return apiFetch("/connectors");
}

/** Full-page navigation so the session cookie is sent to Google OAuth start. */
export function startGoogleOAuth(): void {
  window.location.assign("/api/connectors/google/oauth/start");
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

export const LIFE_MEMORY_DOMAINS = [
  "family",
  "vehicles",
  "home",
  "health",
  "work",
  "finance",
  "people",
  "preferences",
  "procedures",
  "other",
] as const;

export type LifeMemoryDomain = (typeof LIFE_MEMORY_DOMAINS)[number];

export const LIFE_MEMORY_STATUSES = [
  "active",
  "superseded",
  "expired",
  "archived",
] as const;

export type LifeMemoryStatus = (typeof LIFE_MEMORY_STATUSES)[number];

export type LifeMemoryRecord = {
  id: string;
  domain: LifeMemoryDomain;
  title: string;
  content: string;
  tags: string[];
  primaryPersonId: string | null;
  projectId: string | null;
  sourceType: "teach" | "capture" | "ask" | "import";
  sourceId: string | null;
  pinned: boolean;
  status: LifeMemoryStatus;
  supersedesId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listMemories(opts?: {
  domain?: string;
  q?: string;
  status?: LifeMemoryStatus | "all";
}): Promise<{ items: LifeMemoryRecord[] }> {
  const params = new URLSearchParams();
  if (opts?.domain) params.set("domain", opts.domain);
  if (opts?.q?.trim()) params.set("q", opts.q.trim());
  if (opts?.status) params.set("status", opts.status);
  const q = params.toString();
  return apiFetch(`/memory${q ? `?${q}` : ""}`);
}

export async function createMemory(input: {
  title?: string;
  content: string;
  domain?: string | null;
  tags?: string[];
  primaryPersonId?: string | null;
  projectId?: string | null;
  sourceType?: "teach" | "capture" | "ask" | "import";
  sourceId?: string | null;
  pinned?: boolean;
}): Promise<LifeMemoryRecord> {
  return apiFetch("/memory", { method: "POST", body: JSON.stringify(input) });
}

export async function importMemories(input: {
  sourceId?: string | null;
  items: {
    title?: string;
    content: string;
    domain?: string | null;
    tags?: string[];
    pinned?: boolean;
  }[];
}): Promise<{ created: number; failed: number; items: LifeMemoryRecord[] }> {
  return apiFetch("/memory/import", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateMemory(
  memoryId: string,
  input: {
    title?: string;
    content?: string;
    domain?: string | null;
    tags?: string[];
    primaryPersonId?: string | null;
    projectId?: string | null;
    pinned?: boolean;
    status?: LifeMemoryStatus;
    expiresAt?: string | null;
  },
): Promise<LifeMemoryRecord> {
  return apiFetch(`/memory/${encodeURIComponent(memoryId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function supersedeMemory(
  memoryId: string,
  input: {
    title?: string;
    content: string;
    domain?: string | null;
    tags?: string[];
    pinned?: boolean;
    expiresAt?: string | null;
  },
): Promise<{ previous: LifeMemoryRecord; current: LifeMemoryRecord }> {
  return apiFetch(`/memory/${encodeURIComponent(memoryId)}/supersede`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function archiveMemory(memoryId: string): Promise<LifeMemoryRecord> {
  return apiFetch(`/memory/${encodeURIComponent(memoryId)}/archive`, {
    method: "POST",
  });
}

export async function deleteMemory(memoryId: string): Promise<void> {
  await apiFetch(`/memory/${encodeURIComponent(memoryId)}`, { method: "DELETE" });
}

export async function classifyMemory(
  content: string,
): Promise<{ domain: LifeMemoryDomain; title: string; degraded: boolean }> {
  return apiFetch("/memory/classify", {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export async function exportLifeMemoryMarkdown(): Promise<string> {
  const headers: Record<string, string> = { Accept: "text/markdown" };
  const res = await fetch(`${API_BASE}/memory/export.md`, {
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Export failed (${res.status})`);
  }
  return res.text();
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
