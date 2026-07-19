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
  sourceType: "note" | "knowledge" | "task" | "mail";
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

export async function dismissWaitingOn(waitingItemId: string): Promise<{
  ok: boolean;
  waitingItemId: string;
}> {
  return apiFetch("/people/waiting-on/dismiss", {
    method: "POST",
    body: JSON.stringify({ waitingItemId }),
  });
}

export type AttentionItemRecord = {
  id: string;
  title: string;
  summary: string | null;
  dueAt: string;
  kind: "deadline" | "appointment" | "follow_up" | "other";
  status: "open" | "seen" | "snoozed" | "dismissed" | "completed";
  seenAt: string | null;
  snoozedUntil: string | null;
  evidenceText: string | null;
  personId: string | null;
  projectId: string | null;
  confidence: number | null;
  href: string;
  sourceEntityType: string;
  sourceEntityId: string;
};

export async function listAttention(): Promise<{ items: AttentionItemRecord[] }> {
  return apiFetch("/attention");
}

export async function markAttentionSeen(id: string): Promise<AttentionItemRecord> {
  return apiFetch(`/attention/${encodeURIComponent(id)}/seen`, { method: "POST" });
}

export async function dismissAttention(id: string): Promise<AttentionItemRecord> {
  return apiFetch(`/attention/${encodeURIComponent(id)}/dismiss`, { method: "POST" });
}

export async function snoozeAttention(
  id: string,
  body: { preset?: string; until?: string } = { preset: "1d_before" },
): Promise<AttentionItemRecord> {
  return apiFetch(`/attention/${encodeURIComponent(id)}/snooze`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function completeAttention(id: string): Promise<AttentionItemRecord> {
  return apiFetch(`/attention/${encodeURIComponent(id)}/complete`, { method: "POST" });
}

export async function scanAttention(): Promise<{ jobId: string; status: string }> {
  return apiFetch("/attention/scan", { method: "POST" });
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

export type ProjectSourceRecord = {
  id: string;
  recordType: string;
  title: string;
  text: string | null;
  date: string | null;
  amount: number | null;
  payee: string | null;
  category: string | null;
};

export async function listProjectSources(projectId: string): Promise<{
  mail: ProjectSourceRecord[];
  transactions: ProjectSourceRecord[];
}> {
  return apiFetch(`/projects/${encodeURIComponent(projectId)}/sources`);
}

export async function searchProjectSources(
  projectId: string,
  q: string,
  type: "gmail_message" | "finance_transaction",
): Promise<{ results: ProjectSourceRecord[] }> {
  const params = new URLSearchParams({ q, type });
  return apiFetch(
    `/projects/${encodeURIComponent(projectId)}/sources/search?${params.toString()}`,
  );
}

export async function linkProjectSource(
  projectId: string,
  sourceRecordId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/projects/${encodeURIComponent(projectId)}/sources/link`, {
    method: "POST",
    body: JSON.stringify({ sourceRecordId }),
  });
}

export async function unlinkProjectSource(
  projectId: string,
  sourceRecordId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/projects/${encodeURIComponent(projectId)}/sources/unlink`, {
    method: "POST",
    body: JSON.stringify({ sourceRecordId }),
  });
}

export async function listPersonOrganizations(
  personId: string,
): Promise<{ organizations: { organizationId: string; displayName: string; orgType: string }[] }> {
  return apiFetch(`/people/${encodeURIComponent(personId)}/organizations`);
}

export async function linkPersonOrganization(
  personId: string,
  organizationId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/people/${encodeURIComponent(personId)}/organizations/link`, {
    method: "POST",
    body: JSON.stringify({ organizationId }),
  });
}

export async function unlinkPersonOrganization(
  personId: string,
  organizationId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/people/${encodeURIComponent(personId)}/organizations/unlink`, {
    method: "POST",
    body: JSON.stringify({ organizationId }),
  });
}

export async function listOrganizationPeople(
  organizationId: string,
): Promise<{
  people: { personId: string; displayName: string; email: string | null; role: string | null }[];
}> {
  return apiFetch(`/organizations/${encodeURIComponent(organizationId)}/people`);
}

export type SubjectSpendResponse = {
  subjectType: "vehicle" | "home";
  subjectId: string;
  finance: {
    spent: number;
    income: number;
    expenseCount: number;
    formatted: { spent: string; income: string };
  };
  transactions: {
    id: string;
    date: string;
    payee: string;
    amount: number;
    amountFormatted: string;
    category: string | null;
    kind: string;
  }[];
};

export async function getSubjectSpend(
  subjectType: "vehicle" | "home",
  subjectId: string,
): Promise<SubjectSpendResponse> {
  const base = subjectType === "vehicle" ? "vehicles" : "homes";
  return apiFetch(`/${base}/${encodeURIComponent(subjectId)}/spend`);
}

export async function suggestSubjectSpend(
  subjectType: "vehicle" | "home",
  subjectId: string,
): Promise<{
  suggestions: (SubjectSpendResponse["transactions"][number] & {
    score: number;
    matchedOn: string;
  })[];
}> {
  const base = subjectType === "vehicle" ? "vehicles" : "homes";
  return apiFetch(`/${base}/${encodeURIComponent(subjectId)}/spend/suggest`);
}

export async function linkSubjectSpend(
  subjectType: "vehicle" | "home",
  subjectId: string,
  sourceRecordId: string,
): Promise<{ ok: boolean }> {
  const base = subjectType === "vehicle" ? "vehicles" : "homes";
  return apiFetch(`/${base}/${encodeURIComponent(subjectId)}/spend/link`, {
    method: "POST",
    body: JSON.stringify({ sourceRecordId }),
  });
}

export async function unlinkSubjectSpend(
  subjectType: "vehicle" | "home",
  subjectId: string,
  sourceRecordId: string,
): Promise<{ ok: boolean }> {
  const base = subjectType === "vehicle" ? "vehicles" : "homes";
  return apiFetch(`/${base}/${encodeURIComponent(subjectId)}/spend/unlink`, {
    method: "POST",
    body: JSON.stringify({ sourceRecordId }),
  });
}

export type SubjectTimelineItem = {
  at: string;
  kind: string;
  title: string;
  summary: string | null;
  entityType: string;
  entityId: string;
  provenance: string;
  href: string;
};

export async function getSubjectTimeline(
  subjectType: "project" | "vehicle" | "home",
  subjectId: string,
): Promise<{ items: SubjectTimelineItem[] }> {
  if (subjectType === "project") {
    return apiFetch(`/projects/${encodeURIComponent(subjectId)}/timeline`);
  }
  const base = subjectType === "vehicle" ? "vehicles" : "homes";
  return apiFetch(`/${base}/${encodeURIComponent(subjectId)}/timeline`);
}

export async function suggestReceiptMatches(documentId: string): Promise<{
  documentId: string;
  candidates: {
    sourceRecordId: string;
    date: string;
    payee: string;
    amount: number;
    amountFormatted: string;
    score: number;
    reasons: string[];
  }[];
}> {
  return apiFetch(`/documents/${encodeURIComponent(documentId)}/receipt-matches`);
}

export async function confirmReceiptMatch(
  documentId: string,
  sourceRecordId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/documents/${encodeURIComponent(documentId)}/receipt-matches/confirm`, {
    method: "POST",
    body: JSON.stringify({ sourceRecordId }),
  });
}

export async function listFinanceSubscriptions(): Promise<{
  subscriptions: {
    payee: string;
    occurrenceCount: number;
    avgAmount: number;
    avgAmountFormatted: string;
    lastDate: string;
    cadenceDays: number | null;
    confidence: string;
  }[];
}> {
  return apiFetch("/finance/subscriptions");
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

export type AskAnswerImage = {
  attachmentId: string;
  noteId: string;
  noteTitle: string;
  fileName: string;
  mimeType: string;
};

export type QueryRecallResult = {
  answer: string;
  confidence: number;
  caveats: string | null;
  evidence: EvidenceRecord[];
  relatedRecords: { entityType: string; entityId: string; title: string }[];
  images?: AskAnswerImage[];
  suggestedNextAction: string | null;
  threadId: string | null;
  assistantMessageId?: string | null;
  privacy?: {
    model: string | null;
    dataLeftDevice: boolean;
    categoriesSent: string[];
  };
};

export type QueryRecallStreamMeta = {
  threadId: string;
  evidence: EvidenceRecord[];
  relatedRecords: { entityType: string; entityId: string; title: string }[];
  images?: AskAnswerImage[];
  privacy?: QueryRecallResult["privacy"];
};

export async function queryRecall(
  question: string,
  options?: { threadId?: string | null },
): Promise<QueryRecallResult> {
  return apiFetch("/ai/query", {
    method: "POST",
    body: JSON.stringify({
      question,
      threadId: options?.threadId ?? undefined,
    }),
  });
}

// --- Unified Ask & Capture (Intent Router + Action Orchestrator) ----------

export type AskActionType =
  | "create_task"
  | "create_reminder"
  | "save_memory"
  | "create_note"
  | "send_to_inbox";

export type AskProposedActionDraft = {
  title: string;
  content: string;
  dueAt: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  tags: string[];
  domain: string | null;
  kind: "deadline" | "appointment" | "follow_up" | "other" | null;
};

export type AskProposedAction = {
  id: string;
  type: AskActionType;
  label: string;
  draft: AskProposedActionDraft;
  confidence: number;
  reason: string;
};

export type AskPlanRouting = {
  route: "question" | "capture";
  source: "regex" | "model";
  degraded: boolean;
  primaryIntent: string;
  secondaryIntents: string[];
  confidence: number;
  requiresConfirmation: boolean;
  reason: string;
};

export type AskPlanResult = {
  mode: "answer" | "review";
  routing: AskPlanRouting;
  answer: QueryRecallResult | null;
  actions: AskProposedAction[];
  rawCaptureId: string | null;
};

export type AskActionResult = {
  entityType: string;
  entityId: string;
  usedDefaultDueAt?: boolean;
};

/**
 * Unified submit: classify the input, then either answer it (questions) or
 * return draft review cards (captures). Nothing is written except the raw
 * source; the user confirms actions via confirmAskAction().
 */
export async function planAskInput(
  text: string,
  options?: { threadId?: string | null },
): Promise<AskPlanResult> {
  return apiFetch("/ai/plan", {
    method: "POST",
    body: JSON.stringify({ text, threadId: options?.threadId ?? undefined }),
  });
}

/** Execute one user-confirmed proposed action via the existing domain services. */
export async function confirmAskAction(input: {
  type: AskActionType;
  draft: AskProposedActionDraft;
  rawCaptureId?: string | null;
  threadId?: string | null;
}): Promise<AskActionResult> {
  return apiFetch("/ai/actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      type: input.type,
      draft: input.draft,
      rawCaptureId: input.rawCaptureId ?? null,
      threadId: input.threadId ?? null,
    }),
  });
}

/**
 * Streaming Ask over Server-Sent Events. Fires onMeta once (sources) then onToken
 * for each answer chunk, and resolves with the final answer. Callers should catch
 * and fall back to queryRecall() when streaming is unavailable.
 */
export async function queryRecallStream(
  question: string,
  options: {
    threadId?: string | null;
    signal?: AbortSignal;
    onMeta?: (meta: QueryRecallStreamMeta) => void;
    onToken?: (delta: string) => void;
  },
): Promise<QueryRecallResult> {
  const res = await fetch(`${API_BASE}/ai/query/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    credentials: "include",
    body: JSON.stringify({ question, threadId: options.threadId ?? undefined }),
    signal: options.signal,
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let meta: QueryRecallStreamMeta | null = null;
  let final: Partial<QueryRecallResult> | null = null;
  let streamError: string | null = null;

  const handleEvent = (event: string, dataStr: string) => {
    let data: unknown;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return;
    }
    if (event === "meta") {
      meta = data as QueryRecallStreamMeta;
      options.onMeta?.(meta);
    } else if (event === "token") {
      const delta = (data as { delta?: string }).delta ?? "";
      if (delta) {
        answer += delta;
        options.onToken?.(delta);
      }
    } else if (event === "done") {
      final = data as Partial<QueryRecallResult>;
    } else if (event === "error") {
      streamError = (data as { message?: string }).message ?? "Ask failed";
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      }
      if (dataLines.length > 0) handleEvent(event, dataLines.join("\n"));
    }
  }

  if (streamError) throw new Error(streamError);

  // Alias through the declared types: TS narrows closure-mutated `let` unions to
  // `never` in the linear flow, so read them via explicitly-typed locals.
  const doneResult = final as Partial<QueryRecallResult> | null;
  const metaResult = meta as QueryRecallStreamMeta | null;

  return {
    answer: doneResult?.answer ?? answer,
    confidence: doneResult?.confidence ?? 0.6,
    caveats: doneResult?.caveats ?? null,
    evidence: doneResult?.evidence ?? metaResult?.evidence ?? [],
    relatedRecords: doneResult?.relatedRecords ?? metaResult?.relatedRecords ?? [],
    images: doneResult?.images ?? metaResult?.images ?? [],
    suggestedNextAction: doneResult?.suggestedNextAction ?? null,
    threadId: doneResult?.threadId ?? metaResult?.threadId ?? options.threadId ?? null,
    assistantMessageId: doneResult?.assistantMessageId ?? null,
    privacy: doneResult?.privacy ?? metaResult?.privacy,
  };
}

export async function sendAskFeedback(
  messageId: string,
  rating: "up" | "down",
  note?: string | null,
): Promise<{ ok: boolean }> {
  return apiFetch(`/ai/messages/${encodeURIComponent(messageId)}/feedback`, {
    method: "POST",
    body: JSON.stringify({ rating, note: note ?? null }),
  });
}

export async function getWeeklyDigest(): Promise<{
  weekOf: string;
  generatedAt: string;
  summary: string;
  sections: { title: string; bullets: string[] }[];
}> {
  return apiFetch("/digest/weekly");
}

export type UserRuleRecord = {
  id: string;
  body: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export async function listUserRules(): Promise<{ rules: UserRuleRecord[] }> {
  return apiFetch("/user-rules");
}

export async function createUserRule(body: string): Promise<UserRuleRecord> {
  return apiFetch("/user-rules", { method: "POST", body: JSON.stringify({ body }) });
}

export async function updateUserRule(
  ruleId: string,
  input: Partial<{ body: string; enabled: boolean; sortOrder: number }>,
): Promise<UserRuleRecord> {
  return apiFetch(`/user-rules/${encodeURIComponent(ruleId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteUserRule(ruleId: string): Promise<void> {
  await apiFetch(`/user-rules/${encodeURIComponent(ruleId)}`, { method: "DELETE" });
}

export type NotificationSettings = {
  phoneNumber: string | null;
  smsRemindersEnabled: boolean;
  smsLeadMinutes: number;
  /** False when the server has no Twilio credentials configured — texts won't actually send yet. */
  smsConfigured: boolean;
};

export async function getNotificationSettings(): Promise<NotificationSettings> {
  return apiFetch("/settings/notifications");
}

export async function updateNotificationSettings(
  input: Partial<{
    phoneNumber: string | null;
    smsRemindersEnabled: boolean;
    smsLeadMinutes: number;
  }>,
): Promise<NotificationSettings> {
  return apiFetch("/settings/notifications", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function sendTestSmsReminder(): Promise<{ ok: boolean }> {
  return apiFetch("/settings/notifications/test", { method: "POST" });
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
  microsoftOAuthConfigured?: boolean;
  homeyOAuthConfigured?: boolean;
}> {
  return apiFetch("/connectors");
}

/** Full-page navigation so the session cookie is sent to Google OAuth start. */
export function startGoogleOAuth(): void {
  window.location.assign("/api/connectors/google/oauth/start");
}

/** Full-page navigation for Microsoft Graph OAuth. */
export function startMicrosoftOAuth(): void {
  window.location.assign("/api/connectors/microsoft/oauth/start");
}

/** Full-page navigation for Homey (Athom) OAuth. */
export function startHomeyOAuth(): void {
  window.location.assign("/api/connectors/homey/oauth/start");
}

export async function getHomeyWebhookInfo(
  connectorId: string,
): Promise<{ url: string; secret: string; connectorId: string }> {
  return apiFetch(`/connectors/${encodeURIComponent(connectorId)}/homey-webhook`);
}

export async function rotateHomeyWebhookSecret(
  connectorId: string,
): Promise<{ url: string; secret: string; connectorId: string }> {
  return apiFetch(`/connectors/${encodeURIComponent(connectorId)}/homey-webhook/rotate`, {
    method: "POST",
    body: "{}",
  });
}

export async function testHomeyWebhook(
  connectorId: string,
): Promise<{ ok: boolean; result: unknown }> {
  return apiFetch(`/connectors/${encodeURIComponent(connectorId)}/homey-webhook/test`, {
    method: "POST",
    body: "{}",
  });
}

export async function listHomeyAlerts(): Promise<{
  alerts: Array<{
    id: string;
    title: string;
    severity: "info" | "warn" | "emergency";
    kind: string;
    deviceName: string | null;
    message: string | null;
    createdAt: string;
  }>;
}> {
  return apiFetch("/homey/alerts");
}

export async function createConnector(input: {
  name: string;
  type: string;
  description?: string | null;
  settings?: Record<string, unknown>;
}): Promise<{ id: string; name: string; type: string; syncStatus: string }> {
  return apiFetch("/connectors", {
    method: "POST",
    body: JSON.stringify(input),
  });
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

// Note: the standalone Knowledge browse/create UI was folded into Notes
// (Sidebar Consolidation) — knowledge items are still created server-side by
// the document-extraction pipeline, but the frontend no longer calls
// /knowledge directly. See lib/db/migrations/0025_migrate_knowledge_to_notes.sql.

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

export type AdminUserRecord = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  disabledAt: string | null;
  createdAt: string;
};

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ ok: boolean; message: string }> {
  return apiFetch("/auth/change-password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listAdminUsers(): Promise<{ users: AdminUserRecord[] }> {
  return apiFetch("/admin/users");
}

export async function adminSetPassword(
  userId: string,
  newPassword: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/admin/users/${encodeURIComponent(userId)}/password`, {
    method: "POST",
    body: JSON.stringify({ newPassword }),
  });
}

export async function adminSetDisabled(
  userId: string,
  disabled: boolean,
): Promise<{ user: AdminUserRecord }> {
  return apiFetch(`/admin/users/${encodeURIComponent(userId)}/disabled`, {
    method: "POST",
    body: JSON.stringify({ disabled }),
  });
}

export async function adminSetIsAdmin(
  userId: string,
  isAdmin: boolean,
): Promise<{ user: AdminUserRecord }> {
  return apiFetch(`/admin/users/${encodeURIComponent(userId)}/admin`, {
    method: "POST",
    body: JSON.stringify({ isAdmin }),
  });
}
