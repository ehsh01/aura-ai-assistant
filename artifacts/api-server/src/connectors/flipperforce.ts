import type { EvidenceInput, NormalizedSourceRecord, RecallConnector } from "./types";

export const FLIPPERFORCE_API_BASE = "https://tools.flipperforce.com/api/v1";
export const FLIPPERFORCE_APP_BASE = "https://tools.flipperforce.com";

const REQUEST_TIMEOUT_MS = 25_000;
const CACHE_TTL_MS = 60_000;
const MAX_429_RETRIES = 1;

export class FlipperForceAuthError extends Error {
  status = 401;
  constructor(message = "FlipperForce API key was rejected") {
    super(message);
    this.name = "FlipperForceAuthError";
  }
}

export class FlipperForceRateLimitError extends Error {
  status = 429;
  constructor(message = "FlipperForce rate limit") {
    super(message);
    this.name = "FlipperForceRateLimitError";
  }
}

export type FlipperForceWorkspace = {
  uuid: string;
  name?: string | null;
};

export type FlipperForceAccount = {
  email: string | null;
  name: string | null;
  workspaces: FlipperForceWorkspace[];
};

export type FlipperForceProject = {
  uuid: string;
  workspaceUuid: string | null;
  name: string;
  fullAddress: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  stage: string | null;
  investmentStrategy: string | null;
  updatedAt: string | null;
};

export type FlipperForceActivity = {
  uuid: string;
  activityType: string | null;
  performedAt: string | null;
  message: string;
  projectName: string | null;
  projectUuid: string | null;
};

export type FlipperForceMoneyTotals = {
  amount: number;
  tax: number;
  total: number;
};

export type FlipperForceProjectFinancials = {
  project: FlipperForceProject;
  expenses: FlipperForceMoneyTotals;
  income: FlipperForceMoneyTotals;
  net: number;
};

type CacheEntry<T> = { expiresAt: number; value: T };

const accountCache = new Map<string, CacheEntry<FlipperForceAccount>>();
const projectCache = new Map<string, CacheEntry<FlipperForceProject[]>>();

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function clearFlipperForceCache(): void {
  accountCache.clear();
  projectCache.clear();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function resolveFlipperForceApiKey(settings: Record<string, unknown>): string | null {
  const fromSettings = asString(settings.apiKey);
  if (fromSettings) return fromSettings;
  const fromEnv = process.env.FLIPPERFORCE_API_KEY?.trim();
  return fromEnv || null;
}

export function projectAppUrl(uuid: string): string {
  return `${FLIPPERFORCE_APP_BASE}/project/${uuid}`;
}

export function formatUsd(amount: number): string {
  const cents = Math.round(amount * 100);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

function parseWorkspace(raw: unknown): FlipperForceWorkspace | null {
  const row = asRecord(raw);
  const uuid = asString(row.uuid);
  if (!uuid) return null;
  return { uuid, name: asString(row.name) };
}

function parseProject(raw: unknown): FlipperForceProject | null {
  const row = asRecord(raw);
  const uuid = asString(row.uuid);
  if (!uuid) return null;
  return {
    uuid,
    workspaceUuid: asString(row.workspace_uuid),
    name: asString(row.name) ?? asString(row.full_address) ?? uuid,
    fullAddress: asString(row.full_address),
    address1: asString(row.address_1),
    city: asString(row.city),
    state: asString(row.state),
    stage: asString(row.stage),
    investmentStrategy: asString(row.investment_strategy),
    updatedAt: asString(row.updated_at),
  };
}

function parseActivity(raw: unknown): FlipperForceActivity | null {
  const row = asRecord(raw);
  const uuid = asString(row.uuid);
  if (!uuid) return null;
  const project = asRecord(row.project);
  return {
    uuid,
    activityType: asString(row.activity_type),
    performedAt: asString(row.performed_at),
    message: asString(row.message) ?? "Activity",
    projectName: asString(project.name) ?? asString(project.full_address),
    projectUuid: asString(project.uuid),
  };
}

function parseTotals(raw: unknown): FlipperForceMoneyTotals {
  const row = asRecord(raw);
  const amount = asNumber(row.amount);
  const tax = asNumber(row.tax);
  const total = asNumber(row.total) || amount + tax;
  return { amount, tax, total };
}

async function ffGetJson(
  apiKey: string,
  path: string,
  query?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${FLIPPERFORCE_API_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v) url.searchParams.set(k, v);
    }
  }

  let lastStatus = 0;
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    lastStatus = res.status;
    if (res.status === 401 || res.status === 403) {
      throw new FlipperForceAuthError();
    }
    if (res.status === 429) {
      if (attempt < MAX_429_RETRIES) {
        await sleep(800);
        continue;
      }
      throw new FlipperForceRateLimitError();
    }
    if (!res.ok) {
      throw new Error(`FlipperForce API error: ${res.status}`);
    }
    return res.json();
  }
  throw new Error(`FlipperForce API error: ${lastStatus}`);
}

export async function fetchFlipperForceAccount(apiKey: string): Promise<FlipperForceAccount> {
  const cached = cacheGet(accountCache, apiKey);
  if (cached) return cached;
  const json = await ffGetJson(apiKey, "/user/account");
  const root = asRecord(json);
  const data = asRecord(root.data);
  const account = asRecord(data.user_account);
  const user = asRecord(account.user);
  const workspaces = Array.isArray(account.workspaces)
    ? account.workspaces.map(parseWorkspace).filter((w): w is FlipperForceWorkspace => Boolean(w))
    : [];
  const parsed: FlipperForceAccount = {
    email: asString(user.email),
    name: asString(user.name) ?? asString(user.first_name),
    workspaces,
  };
  cacheSet(accountCache, apiKey, parsed);
  return parsed;
}

export async function testFlipperForceConnection(apiKey: string): Promise<FlipperForceAccount> {
  return fetchFlipperForceAccount(apiKey);
}

export async function fetchFlipperForceProjects(apiKey: string): Promise<FlipperForceProject[]> {
  const cached = cacheGet(projectCache, apiKey);
  if (cached) return cached;
  const json = await ffGetJson(apiKey, "/project/list");
  const root = asRecord(json);
  const data = root.data;
  const list = Array.isArray(data) ? data : Array.isArray(asRecord(data).projects) ? asRecord(data).projects : [];
  const projects = (list as unknown[])
    .map(parseProject)
    .filter((p): p is FlipperForceProject => Boolean(p));
  cacheSet(projectCache, apiKey, projects);
  return projects;
}

export async function fetchFlipperForceActivity(
  apiKey: string,
  workspaceUuid: string,
  opts?: { perPage?: number },
): Promise<FlipperForceActivity[]> {
  const json = await ffGetJson(apiKey, `/workspace/${workspaceUuid}/activity-log/list`, {
    per_page: String(opts?.perPage ?? 40),
  });
  const root = asRecord(json);
  const data = root.data;
  const list = Array.isArray(data)
    ? data
    : Array.isArray(asRecord(data).activity_logs)
      ? asRecord(data).activity_logs
      : Array.isArray(asRecord(data).items)
        ? asRecord(data).items
        : [];
  return (list as unknown[])
    .map(parseActivity)
    .filter((a): a is FlipperForceActivity => Boolean(a));
}

export async function fetchProjectExpenseTotals(
  apiKey: string,
  projectUuid: string,
): Promise<FlipperForceMoneyTotals> {
  const json = await ffGetJson(apiKey, `/project/${projectUuid}/expense-line-items/list`, {
    per_page: "1",
  });
  const data = asRecord(asRecord(json).data);
  return parseTotals(data.totals);
}

export async function fetchProjectIncomeTotals(
  apiKey: string,
  projectUuid: string,
): Promise<FlipperForceMoneyTotals> {
  const json = await ffGetJson(apiKey, `/project/${projectUuid}/income/list`, {
    per_page: "1",
  });
  const data = asRecord(asRecord(json).data);
  return parseTotals(data.totals);
}

export async function fetchProjectFinancials(
  apiKey: string,
  project: FlipperForceProject,
): Promise<FlipperForceProjectFinancials> {
  const [expenses, income] = await Promise.all([
    fetchProjectExpenseTotals(apiKey, project.uuid),
    fetchProjectIncomeTotals(apiKey, project.uuid),
  ]);
  return {
    project,
    expenses,
    income,
    net: Math.round((income.total - expenses.total) * 100) / 100,
  };
}

export type FlipperForceRawRecord = {
  externalId: string;
  recordType: "flipperforce_project";
  recordTitle: string;
  recordText: string;
  sourceUrl?: string | null;
  sourceCreatedAt?: string | null;
  metadata?: Record<string, unknown>;
};

export function projectToRawRecord(project: FlipperForceProject): FlipperForceRawRecord {
  const address = project.fullAddress ?? project.address1 ?? "";
  const bits = [
    `FlipperForce project ${project.name}`,
    address ? `address: ${address}` : null,
    project.city ? `city: ${project.city}` : null,
    project.state ? `state: ${project.state}` : null,
    project.stage ? `stage: ${project.stage}` : null,
    project.investmentStrategy ? `strategy: ${project.investmentStrategy}` : null,
    "source=flipperforce_project rehab property flip",
  ].filter(Boolean);
  return {
    externalId: `flipperforce-project:${project.uuid}`,
    recordType: "flipperforce_project",
    recordTitle: project.name,
    recordText: bits.join("\n"),
    sourceUrl: projectAppUrl(project.uuid),
    sourceCreatedAt: project.updatedAt,
    metadata: {
      projectUuid: project.uuid,
      workspaceUuid: project.workspaceUuid,
      stage: project.stage,
      fullAddress: project.fullAddress,
      investmentStrategy: project.investmentStrategy,
    },
  };
}

export async function fetchFlipperForceBundle(apiKey: string): Promise<FlipperForceRawRecord[]> {
  const projects = await fetchFlipperForceProjects(apiKey);
  return projects.map(projectToRawRecord);
}

export function matchFlipperForceProject(
  hint: string | null,
  projects: FlipperForceProject[],
): FlipperForceProject | null {
  if (!projects.length) return null;
  const needle = (hint ?? "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!needle) return projects.length === 1 ? projects[0]! : null;

  const scored = projects.map((p) => {
    const hay = [p.name, p.fullAddress, p.address1, p.city, p.state]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    let score = 0;
    if (hay === needle) score = 100;
    else if (hay.includes(needle)) score = 80;
    else {
      const tokens = needle.split(" ").filter((t) => t.length >= 2);
      const hits = tokens.filter((t) => hay.includes(t)).length;
      score = hits * 10 + (hits === tokens.length ? 20 : 0);
    }
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 20) return null;
  return best.p;
}

export function formatProjectLine(project: FlipperForceProject): string {
  const addr = project.fullAddress ?? project.address1;
  const stage = project.stage ? ` · ${project.stage}` : "";
  return addr && addr !== project.name ? `${project.name} (${addr})${stage}` : `${project.name}${stage}`;
}

export const flipperforceConnector: RecallConnector = {
  id: "flipperforce",
  type: "flipperforce",
  sourceOfTruth: "read_only_external",
  async normalize(records: unknown[]): Promise<NormalizedSourceRecord[]> {
    return (records as FlipperForceRawRecord[]).map((row) => ({
      externalId: row.externalId,
      recordType: row.recordType,
      recordTitle: row.recordTitle,
      recordText: row.recordText,
      recordMetadata: row.metadata ?? {},
      sourceUrl: row.sourceUrl ?? null,
      sourceCreatedAt: row.sourceCreatedAt ?? null,
    }));
  },
  mapEvidence(record: NormalizedSourceRecord): EvidenceInput[] {
    return [
      {
        claimType: "summary_based_on",
        evidenceText: record.recordText ?? record.recordTitle ?? null,
        sourceRecordExternalId: record.externalId,
        url: record.sourceUrl ?? null,
      },
    ];
  },
};
