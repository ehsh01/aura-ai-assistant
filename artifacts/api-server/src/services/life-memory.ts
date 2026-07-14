import { and, desc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  LIFE_MEMORY_DOMAINS,
  LIFE_MEMORY_STATUSES,
  lifeMemories,
  type LifeMemory,
  type LifeMemoryDomain,
  type LifeMemorySourceType,
  type LifeMemoryStatus,
} from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newMemoryId } from "../lib/recall-format";
import { aiService } from "./ai";
import { writeAuditLog } from "./audit";
import { warmEntityEmbedding } from "./embedding-cache";
import { syncPrimaryPersonLink } from "./entity-links";

export type LifeMemoryDto = {
  id: string;
  domain: LifeMemoryDomain;
  title: string;
  content: string;
  tags: string[];
  primaryPersonId: string | null;
  projectId: string | null;
  sourceType: LifeMemorySourceType;
  sourceId: string | null;
  pinned: boolean;
  status: LifeMemoryStatus;
  supersedesId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateMemoryInput = {
  title?: string;
  content: string;
  domain?: LifeMemoryDomain | string | null;
  tags?: string[];
  primaryPersonId?: string | null;
  projectId?: string | null;
  sourceType?: LifeMemorySourceType;
  sourceId?: string | null;
  pinned?: boolean;
  expiresAt?: string | Date | null;
  supersedesId?: string | null;
};

export type UpdateMemoryInput = {
  title?: string;
  content?: string;
  domain?: LifeMemoryDomain | string | null;
  tags?: string[];
  primaryPersonId?: string | null;
  projectId?: string | null;
  pinned?: boolean;
  status?: LifeMemoryStatus | string;
  expiresAt?: string | Date | null;
};

export type ClassifyMemoryResult = {
  domain: LifeMemoryDomain;
  title: string;
  degraded: boolean;
};

const DOMAIN_SET = new Set<string>(LIFE_MEMORY_DOMAINS);
const STATUS_SET = new Set<string>(LIFE_MEMORY_STATUSES);

const DOMAIN_KEYWORDS: { domain: LifeMemoryDomain; re: RegExp }[] = [
  { domain: "vehicles", re: /\b(car|truck|vin|tesla|toyota|honda|bmw|ford|vehicle|license plate|registration|mileage|oil change)\b/i },
  { domain: "family", re: /\b(wife|husband|spouse|son|daughter|kids?|child|mom|dad|mother|father|brother|sister|family|birthday|anniversary|niece|nephew|cousin|aunt|uncle|grandson|granddaughter|grandchild|in-?laws?|boyfriend|girlfriend)\b/i },
  { domain: "home", re: /\b(house|home|apartment|mortgage|landlord|lease|plumber|hvac|yard|fence|renovation|address)\b/i },
  { domain: "health", re: /\b(doctor|dentist|medication|prescription|allergy|clinic|hospital|therapy|insurance|health)\b/i },
  { domain: "work", re: /\b(work|job|office|coworker|boss|meeting|project|client|employer|salary|career)\b/i },
  { domain: "finance", re: /\b(bank|budget|tax|irs|invoice|payment|credit card|mortgage payment|investment|401k|finance)\b/i },
  { domain: "people", re: /\b(friend|contact|email|phone|met|introduced|person named)\b/i },
  { domain: "preferences", re: /\b(prefer|favorite|favourite|always|never|like to|don't like|allergy to|default)\b/i },
  { domain: "procedures", re: /\b(how to|procedure|steps|checklist|process|sop|instructions|recipe)\b/i },
];

function normalizeDomain(value: string | null | undefined): LifeMemoryDomain {
  const d = (value ?? "other").trim().toLowerCase();
  return DOMAIN_SET.has(d) ? (d as LifeMemoryDomain) : "other";
}

export function normalizeMemoryStatus(value: string | null | undefined): LifeMemoryStatus {
  const s = (value ?? "active").trim().toLowerCase();
  return STATUS_SET.has(s) ? (s as LifeMemoryStatus) : "active";
}

export function parseExpiresAt(value: string | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Active for Ask/insights: status=active and not past expiresAt. */
export function isMemoryActiveForRetrieval(
  row: Pick<LifeMemory, "status" | "expiresAt">,
  now: Date = new Date(),
): boolean {
  if (normalizeMemoryStatus(row.status) !== "active") return false;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/** SQL filter for active (non-expired) memories used by Ask corpus paths. */
export function activeLifeMemorySql(now: Date = new Date()) {
  return and(
    eq(lifeMemories.status, "active"),
    or(isNull(lifeMemories.expiresAt), gt(lifeMemories.expiresAt, now))!,
  );
}

function toDto(row: LifeMemory): LifeMemoryDto {
  return {
    id: row.id,
    domain: normalizeDomain(row.domain),
    title: row.title,
    content: row.content,
    tags: row.tags ?? [],
    primaryPersonId: row.primaryPersonId ?? null,
    projectId: row.projectId ?? null,
    sourceType: (row.sourceType as LifeMemorySourceType) || "teach",
    sourceId: row.sourceId ?? null,
    pinned: row.pinned,
    status: normalizeMemoryStatus(row.status),
    supersedesId: row.supersedesId ?? null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function firstLineTitle(text: string, fallback = "Memory"): string {
  const line = text.trim().split(/\r?\n/).find(Boolean) ?? fallback;
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

export function classifyMemoryHeuristic(raw: string): ClassifyMemoryResult {
  const text = raw.trim();
  for (const rule of DOMAIN_KEYWORDS) {
    if (rule.re.test(text)) {
      return { domain: rule.domain, title: firstLineTitle(text), degraded: false };
    }
  }
  return { domain: "other", title: firstLineTitle(text), degraded: false };
}

export async function classifyMemoryText(raw: string): Promise<ClassifyMemoryResult> {
  const fallback = classifyMemoryHeuristic(raw);
  if (!raw.trim() || aiService.getStatus().degraded) return { ...fallback, degraded: true };

  try {
    const result = await aiService.chat({
      messages: [
        {
          role: "system",
          content:
            "Classify a personal life fact into one domain and a short title. " +
            `Domains: ${LIFE_MEMORY_DOMAINS.join(", ")}. ` +
            'Reply ONLY with JSON: {"domain":"...","title":"..."}',
        },
        { role: "user", content: raw.slice(0, 2000) },
      ],
    });
    const content = result.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { ...fallback, degraded: true };
    const parsed = JSON.parse(match[0]) as { domain?: string; title?: string };
    return {
      domain: normalizeDomain(parsed.domain),
      title: (parsed.title?.trim() || fallback.title).slice(0, 500),
      degraded: Boolean(result.degraded),
    };
  } catch {
    return { ...fallback, degraded: true };
  }
}

function warmMemory(userId: string, dto: LifeMemoryDto): void {
  if (dto.status !== "active") return;
  warmEntityEmbedding(userId, {
    entityType: "memory",
    entityId: dto.id,
    text: `domain=${dto.domain} ${dto.title}\n${dto.content}${
      dto.pinned ? " pinned=true" : ""
    } tags=${dto.tags.join(",")}`,
  });
}

export async function listMemoriesForUser(
  userId: string,
  opts?: {
    domain?: string;
    q?: string;
    limit?: number;
    /** Default active-only. Pass "all" for history UI. */
    status?: LifeMemoryStatus | "all";
  },
): Promise<LifeMemoryDto[]> {
  const domain = opts?.domain ? normalizeDomain(opts.domain) : null;
  const q = opts?.q?.trim();
  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 500);
  const statusOpt = opts?.status ?? "active";
  const now = new Date();

  const filters = [eq(lifeMemories.userId, userId)];
  if (statusOpt === "active") {
    filters.push(activeLifeMemorySql(now)!);
  } else if (statusOpt !== "all") {
    filters.push(eq(lifeMemories.status, normalizeMemoryStatus(statusOpt)));
  }
  if (domain && opts?.domain && opts.domain !== "all") {
    filters.push(eq(lifeMemories.domain, domain));
  }
  if (q) {
    const pattern = `%${q}%`;
    filters.push(
      or(
        ilike(lifeMemories.title, pattern),
        ilike(lifeMemories.content, pattern),
        sql`${lifeMemories.tags}::text ilike ${pattern}`,
      )!,
    );
  }

  const rows = await getDb()
    .select()
    .from(lifeMemories)
    .where(and(...filters))
    .orderBy(desc(lifeMemories.pinned), desc(lifeMemories.updatedAt))
    .limit(limit);

  return rows.map(toDto);
}

export async function getMemoryForUser(
  userId: string,
  memoryId: string,
): Promise<LifeMemoryDto | null> {
  const rows = await getDb()
    .select()
    .from(lifeMemories)
    .where(and(eq(lifeMemories.id, memoryId), eq(lifeMemories.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function createMemoryForUser(
  userId: string,
  input: CreateMemoryInput,
): Promise<LifeMemoryDto> {
  const content = input.content.trim();
  if (!content) throw new Error("Memory content is required");

  let domain = input.domain ? normalizeDomain(input.domain) : null;
  let title = input.title?.trim() || "";
  if (!domain || !title) {
    if (input.sourceType === "import") {
      const classified = classifyMemoryHeuristic(content);
      domain = domain ?? classified.domain;
      title = title || classified.title;
    } else {
      const classified = await classifyMemoryText(content);
      domain = domain ?? classified.domain;
      title = title || classified.title;
    }
  }

  const now = new Date();
  const [row] = await getDb()
    .insert(lifeMemories)
    .values({
      id: newMemoryId(),
      userId,
      domain,
      title: title.slice(0, 500) || "Memory",
      content,
      tags: input.tags ?? [],
      primaryPersonId: input.primaryPersonId ?? null,
      projectId: input.projectId ?? null,
      sourceType: input.sourceType ?? "teach",
      sourceId: input.sourceId ?? null,
      pinned: input.pinned ?? false,
      status: "active",
      supersedesId: input.supersedesId ?? null,
      expiresAt: parseExpiresAt(input.expiresAt),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const dto = toDto(row!);
  await writeAuditLog({
    userId,
    action: "memory_created",
    entityType: "memory",
    entityId: dto.id,
    metadata: {
      domain: dto.domain,
      title: dto.title,
      sourceType: dto.sourceType,
      supersedesId: dto.supersedesId,
    },
  });
  warmMemory(userId, dto);
  await syncPrimaryPersonLink(userId, "memory", dto.id, dto.primaryPersonId);
  return dto;
}

/** Bulk create for Life File import — one request, no per-item AI classify. */
export async function importMemoriesForUser(
  userId: string,
  items: CreateMemoryInput[],
  sourceId?: string | null,
): Promise<{ created: LifeMemoryDto[]; failed: number }> {
  const created: LifeMemoryDto[] = [];
  let failed = 0;
  for (const item of items) {
    try {
      const dto = await createMemoryForUser(userId, {
        ...item,
        sourceType: "import",
        sourceId: item.sourceId ?? sourceId ?? null,
      });
      created.push(dto);
    } catch {
      failed += 1;
    }
  }
  await writeAuditLog({
    userId,
    action: "memory_import",
    entityType: "memory",
    entityId: null,
    metadata: {
      created: created.length,
      failed,
      sourceId: sourceId ?? null,
    },
  });
  return { created, failed };
}

export async function updateMemoryForUser(
  userId: string,
  memoryId: string,
  input: UpdateMemoryInput,
): Promise<LifeMemoryDto | null> {
  const existing = await getMemoryForUser(userId, memoryId);
  if (!existing) return null;

  const [row] = await getDb()
    .update(lifeMemories)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim().slice(0, 500) || "Memory" } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.domain !== undefined ? { domain: normalizeDomain(input.domain) } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.primaryPersonId !== undefined
        ? { primaryPersonId: input.primaryPersonId }
        : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      ...(input.status !== undefined ? { status: normalizeMemoryStatus(input.status) } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: parseExpiresAt(input.expiresAt) } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(lifeMemories.id, memoryId), eq(lifeMemories.userId, userId)))
    .returning();

  if (!row) return null;
  const dto = toDto(row);
  warmMemory(userId, dto);
  if (input.primaryPersonId !== undefined) {
    await syncPrimaryPersonLink(userId, "memory", dto.id, dto.primaryPersonId);
  }
  return dto;
}

/**
 * Correct a fact: create a new active memory and mark the prior one superseded.
 * Prior version stays inspectable but leaves Ask/retrieval.
 */
export async function supersedeMemoryForUser(
  userId: string,
  previousMemoryId: string,
  input: CreateMemoryInput,
): Promise<{ previous: LifeMemoryDto; current: LifeMemoryDto } | null> {
  const previous = await getMemoryForUser(userId, previousMemoryId);
  if (!previous) return null;

  const current = await createMemoryForUser(userId, {
    title: input.title ?? previous.title,
    content: input.content,
    domain: input.domain ?? previous.domain,
    tags: input.tags ?? previous.tags,
    primaryPersonId:
      input.primaryPersonId !== undefined ? input.primaryPersonId : previous.primaryPersonId,
    projectId: input.projectId !== undefined ? input.projectId : previous.projectId,
    sourceType: input.sourceType ?? "teach",
    sourceId: input.sourceId ?? previous.sourceId,
    pinned: input.pinned ?? previous.pinned,
    expiresAt: input.expiresAt !== undefined ? input.expiresAt : previous.expiresAt,
    supersedesId: previousMemoryId,
  });

  const [prevRow] = await getDb()
    .update(lifeMemories)
    .set({
      status: "superseded",
      pinned: false,
      updatedAt: new Date(),
    })
    .where(and(eq(lifeMemories.id, previousMemoryId), eq(lifeMemories.userId, userId)))
    .returning();

  await writeAuditLog({
    userId,
    action: "memory_superseded",
    entityType: "memory",
    entityId: previousMemoryId,
    metadata: { replacedBy: current.id },
  });

  return {
    previous: prevRow ? toDto(prevRow) : { ...previous, status: "superseded", pinned: false },
    current,
  };
}

export async function archiveMemoryForUser(
  userId: string,
  memoryId: string,
): Promise<LifeMemoryDto | null> {
  return updateMemoryForUser(userId, memoryId, { status: "archived", pinned: false });
}

export async function deleteMemoryForUser(
  userId: string,
  memoryId: string,
): Promise<boolean> {
  const deleted = await getDb()
    .delete(lifeMemories)
    .where(and(eq(lifeMemories.id, memoryId), eq(lifeMemories.userId, userId)))
    .returning({ id: lifeMemories.id });
  if (deleted.length > 0) {
    await writeAuditLog({
      userId,
      action: "memory_deleted",
      entityType: "memory",
      entityId: memoryId,
      metadata: {},
    });
  }
  return deleted.length > 0;
}

/** Growing Life File — markdown grouped by domain (active only). */
export async function exportMemoriesMarkdownForUser(userId: string): Promise<string> {
  const items = await listMemoriesForUser(userId, { limit: 500, status: "active" });
  const byDomain = new Map<LifeMemoryDomain, LifeMemoryDto[]>();
  for (const d of LIFE_MEMORY_DOMAINS) byDomain.set(d, []);
  for (const item of items) {
    byDomain.get(item.domain)?.push(item);
  }

  const lines: string[] = [
    "# Recall Life Memory",
    "",
    `_Exported ${new Date().toISOString().slice(0, 10)} · ${items.length} active memories_`,
    "",
  ];

  for (const domain of LIFE_MEMORY_DOMAINS) {
    const group = byDomain.get(domain) ?? [];
    if (group.length === 0) continue;
    const heading = domain.charAt(0).toUpperCase() + domain.slice(1);
    lines.push(`## ${heading}`, "");
    for (const m of group) {
      const pin = m.pinned ? " 📌" : "";
      lines.push(`### ${m.title}${pin}`, "");
      lines.push(m.content.trim() || "_(empty)_", "");
      if (m.tags.length) lines.push(`_Tags: ${m.tags.join(", ")}_`, "");
    }
  }

  if (items.length === 0) {
    lines.push("_No memories yet. Teach Recall something lasting._", "");
  }

  return lines.join("\n");
}

/** Drop inactive/expired rows when loading by id (person inject / shared context). */
export function filterActiveMemoryRows<T extends Pick<LifeMemory, "status" | "expiresAt">>(
  rows: T[],
  now: Date = new Date(),
): T[] {
  return rows.filter((row) => isMemoryActiveForRetrieval(row, now));
}
