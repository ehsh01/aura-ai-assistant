/**
 * OpenAI spend tracking and the background budget guard.
 *
 * Two jobs:
 *  1. Record what every model call cost, attributed to a feature, so spend is
 *     explainable instead of a single opaque number on the OpenAI dashboard.
 *  2. Stop background work at the global daily cap and softly degrade new Ask
 *     queries at the per-user cap. In-flight streams are never interrupted.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gte, sql } from "drizzle-orm";
import { aiUsage } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { isEnabled } from "../lib/feature-flags";
import { logger } from "../lib/logger";

/** Product areas that spend money. Keep stable; used for reporting. */
export type AiFeature =
  | "attachment_ocr"
  | "digest"
  | "deadline_extract"
  | "waiting_extract"
  | "capture_classify"
  | "intent_route"
  | "ask_query"
  | "transcribe"
  | "tts"
  | "embedding"
  | "other";

/** All background features, gated by the daily budget. */
const BACKGROUND_FEATURES: ReadonlySet<AiFeature> = new Set<AiFeature>([
  "attachment_ocr",
  "digest",
  "deadline_extract",
  "waiting_extract",
  "capture_classify",
]);

/**
 * USD per 1M tokens. Approximate and only used for budgeting and reporting —
 * OpenAI's invoice remains the source of truth. Unknown models fall back to the
 * most expensive known rate so a new model cannot silently escape the cap.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4.1": { input: 2, output: 8 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
  "whisper-1": { input: 0, output: 0 },
  "tts-1": { input: 0, output: 0 },
};

const FALLBACK_PRICE = { input: 2.5, output: 10 };

export function priceFor(model: string): { input: number; output: number } {
  const key = model.trim().toLowerCase();
  if (PRICING[key]) return PRICING[key]!;
  // Match a versioned name like "gpt-4.1-mini-2025-04-14".
  for (const [name, price] of Object.entries(PRICING)) {
    if (key.startsWith(name)) return price;
  }
  return FALLBACK_PRICE;
}

/** Cost of one call in micro-dollars (1e-6 USD). */
export function costMicrosFor(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const price = priceFor(model);
  const input = (Math.max(0, promptTokens) / 1_000_000) * price.input;
  const output = (Math.max(0, completionTokens) / 1_000_000) * price.output;
  return Math.round((input + output) * 1_000_000);
}

export type RecordUsageInput = {
  userId?: string | null;
  feature: AiFeature;
  model: string;
  background?: boolean;
  promptTokens?: number | null;
  completionTokens?: number | null;
};

/**
 * Persist one call's usage. Never throws: accounting must not break the feature
 * that just succeeded.
 */
export async function recordAiUsage(input: RecordUsageInput): Promise<void> {
  const promptTokens = Math.max(0, Math.round(input.promptTokens ?? 0));
  const completionTokens = Math.max(0, Math.round(input.completionTokens ?? 0));
  try {
    await getDb().insert(aiUsage).values({
      userId: input.userId ?? null,
      feature: input.feature,
      model: input.model.slice(0, 96),
      background: input.background ?? false,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costMicros: costMicrosFor(input.model, promptTokens, completionTokens),
    });
  } catch (err) {
    logger.warn({ err, feature: input.feature }, "Failed to record AI usage");
  }
}

/**
 * Ambient attribution. The AI service makes model calls from a dozen places;
 * rather than thread a feature argument through every one, callers name the
 * feature at the boundary and the instrumented client reads it from here.
 */
type FeatureContext = { feature: AiFeature; userId?: string | null };
const featureStore = new AsyncLocalStorage<FeatureContext>();

/** Tag every model call made inside `fn` with this feature. */
export function withAiFeature<T>(
  ctx: FeatureContext,
  fn: () => Promise<T>,
): Promise<T> {
  return featureStore.run(ctx, fn);
}

export function currentAiFeature(): FeatureContext {
  return featureStore.getStore() ?? { feature: "other" };
}

export function isBackgroundFeature(feature: AiFeature): boolean {
  return BACKGROUND_FEATURES.has(feature);
}

/** Convenience wrapper for the `usage` block OpenAI returns on completions. */
export function usageTokens(usage: unknown): {
  promptTokens: number;
  completionTokens: number;
} {
  const u = (usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
  return {
    promptTokens: Number(u.prompt_tokens ?? 0),
    completionTokens: Number(u.completion_tokens ?? 0),
  };
}

function startOfTodayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Total spend in USD since midnight UTC across all users. */
export async function spendTodayUsd(now: Date = new Date()): Promise<number> {
  try {
    const rows = await getDb()
      .select({ micros: sql<string>`COALESCE(SUM(${aiUsage.costMicros}), 0)` })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, startOfTodayUtc(now)));
    return Number(rows[0]?.micros ?? 0) / 1_000_000;
  } catch (err) {
    logger.warn({ err }, "Failed to read today's AI spend");
    // Fail open: a reporting outage must not silently disable the product.
    return 0;
  }
}

/** Total spend in USD since midnight UTC for one user. */
export async function spendTodayUsdForUser(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  try {
    const rows = await getDb()
      .select({ micros: sql<string>`COALESCE(SUM(${aiUsage.costMicros}), 0)` })
      .from(aiUsage)
      .where(
        and(
          eq(aiUsage.userId, userId),
          gte(aiUsage.createdAt, startOfTodayUtc(now)),
        ),
      );
    return Number(rows[0]?.micros ?? 0) / 1_000_000;
  } catch (err) {
    logger.warn({ err, userId }, "Failed to read user's AI spend");
    return 0;
  }
}

/** Daily cap in USD for background work. 0 or unset disables the cap. */
export function dailyBudgetUsd(): number {
  const raw = Number(process.env.AI_DAILY_BUDGET_USD ?? "0");
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** Per-user daily cap in USD for Ask. 0 or unset disables the cap. */
export function dailyBudgetUsdPerUser(): number {
  const raw = Number(process.env.AI_DAILY_BUDGET_USD_PER_USER ?? "0");
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function featureEnabled(feature: AiFeature): boolean {
  if (!isEnabled("RECALL_BACKGROUND_AI_ENABLED")) return false;
  if (feature === "attachment_ocr" && !isEnabled("RECALL_ATTACHMENT_OCR_ENABLED")) {
    return false;
  }
  if (feature === "digest" && !isEnabled("RECALL_AI_DIGESTS_ENABLED")) return false;
  if (
    (feature === "deadline_extract" || feature === "waiting_extract") &&
    !isEnabled("RECALL_EMAIL_AI_SCAN_ENABLED")
  ) {
    return false;
  }
  return true;
}

/**
 * Cached so a tight background loop doesn't run a SUM() per call.
 * Short enough that the cap takes effect within a minute of being crossed.
 */
const BUDGET_CACHE_MS = 60_000;
let budgetCache: { at: number; spend: number } | null = null;
const userBudgetCache = new Map<string, { at: number; spend: number }>();

export function resetBudgetCacheForTests(): void {
  budgetCache = null;
  userBudgetCache.clear();
}

/**
 * Whether a background model call may proceed. Checks the kill switches first
 * (free) and only then the budget (one cached query per minute).
 */
export async function allowBackgroundAi(feature: AiFeature): Promise<boolean> {
  if (!BACKGROUND_FEATURES.has(feature)) return true;
  if (!featureEnabled(feature)) return false;

  const budget = dailyBudgetUsd();
  if (budget <= 0) return true;

  const now = Date.now();
  if (!budgetCache || now - budgetCache.at > BUDGET_CACHE_MS) {
    budgetCache = { at: now, spend: await spendTodayUsd() };
  }
  if (budgetCache.spend < budget) return true;

  logger.warn(
    { feature, spend: budgetCache.spend, budget },
    "Daily AI budget reached — skipping background work",
  );
  return false;
}

/**
 * Soft user-facing budget guard. It is intentionally checked before Ask starts
 * so an in-flight streamed response is never interrupted.
 */
export async function allowUserAi(feature: AiFeature, userId: string): Promise<boolean> {
  if (feature !== "ask_query") return true;
  const budget = dailyBudgetUsdPerUser();
  if (budget <= 0) return true;

  const now = Date.now();
  let cached = userBudgetCache.get(userId);
  if (!cached || now - cached.at > BUDGET_CACHE_MS) {
    cached = { at: now, spend: await spendTodayUsdForUser(userId) };
    userBudgetCache.set(userId, cached);
  }
  if (cached.spend < budget) return true;

  logger.warn(
    { feature, userId, spend: cached.spend, budget },
    "Per-user daily AI budget reached",
  );
  return false;
}

export type UsageSummaryRow = {
  feature: string;
  model: string;
  calls: number;
  totalTokens: number;
  costUsd: number;
};

export type UsageSummaryDay = {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string;
  calls: number;
  costUsd: number;
};

export type UsageSummary = {
  since: string;
  /** True when the numbers cover every user, not just the requester. */
  everyone: boolean;
  totalUsd: number;
  todayUsd: number;
  budgetUsd: number;
  rows: UsageSummaryRow[];
  daily: UsageSummaryDay[];
};

/**
 * Spend over the last N days, broken down per day and per feature/model.
 * Pass a `userId` to scope it to one person; omit it for the whole install.
 */
export async function usageSummary(
  days = 30,
  userId?: string,
): Promise<UsageSummary> {
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000);
  const scope = userId
    ? and(gte(aiUsage.createdAt, since), eq(aiUsage.userId, userId))
    : gte(aiUsage.createdAt, since);

  const db = getDb();
  const [rows, daily] = await Promise.all([
    db
      .select({
        feature: aiUsage.feature,
        model: aiUsage.model,
        calls: sql<string>`COUNT(*)`,
        totalTokens: sql<string>`COALESCE(SUM(${aiUsage.totalTokens}), 0)`,
        micros: sql<string>`COALESCE(SUM(${aiUsage.costMicros}), 0)`,
      })
      .from(aiUsage)
      .where(scope)
      .groupBy(aiUsage.feature, aiUsage.model)
      .orderBy(sql`COALESCE(SUM(${aiUsage.costMicros}), 0) DESC`),
    db
      .select({
        day: sql<string>`TO_CHAR(${aiUsage.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
        calls: sql<string>`COUNT(*)`,
        micros: sql<string>`COALESCE(SUM(${aiUsage.costMicros}), 0)`,
      })
      .from(aiUsage)
      .where(scope)
      .groupBy(sql`TO_CHAR(${aiUsage.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`)
      .orderBy(sql`TO_CHAR(${aiUsage.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD') DESC`),
  ]);

  const mapped = rows.map((r) => ({
    feature: r.feature,
    model: r.model,
    calls: Number(r.calls),
    totalTokens: Number(r.totalTokens),
    costUsd: Number(r.micros) / 1_000_000,
  }));

  return {
    since: since.toISOString(),
    everyone: !userId,
    totalUsd: mapped.reduce((sum, r) => sum + r.costUsd, 0),
    todayUsd: userId ? await spendTodayUsdForUser(userId) : await spendTodayUsd(),
    budgetUsd: dailyBudgetUsd(),
    rows: mapped,
    daily: daily.map((d) => ({
      date: d.day,
      calls: Number(d.calls),
      costUsd: Number(d.micros) / 1_000_000,
    })),
  };
}
