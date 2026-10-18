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
  | "attachment_ocr_ai"
  | "digest"
  | "home_digest"
  | "deadline_extract"
  | "waiting_extract"
  | "waiting_outcome"
  | "capture_classify"
  | "intent_route"
  | "ask_query"
  | "voice_ask"
  | "transcribe"
  | "tts"
  | "voice_tts"
  | "embedding"
  | "embedding_warm"
  | "other";

/** All background features, gated by the daily budget. */
const BACKGROUND_FEATURES: ReadonlySet<AiFeature> = new Set<AiFeature>([
  "attachment_ocr",
  "digest",
  "home_digest",
  "deadline_extract",
  "waiting_extract",
  "waiting_outcome",
  "capture_classify",
  "embedding_warm",
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
  provider?: string | null;
  model: string;
  background?: boolean;
  promptTokens?: number | null;
  completionTokens?: number | null;
  characters?: number | null;
  seconds?: number | null;
  /** For non-token-priced APIs such as TTS and Whisper. */
  costMicros?: number | null;
};

/**
 * Persist one call's usage. Never throws: accounting must not break the feature
 * that just succeeded.
 */
export async function recordAiUsage(
  input: RecordUsageInput,
  options: { strict?: boolean } = {},
): Promise<void> {
  const promptTokens = Math.max(0, Math.round(input.promptTokens ?? 0));
  const completionTokens = Math.max(0, Math.round(input.completionTokens ?? 0));
  try {
    await getDb()
      .insert(aiUsage)
      .values({
        userId: input.userId ?? null,
        feature: input.feature,
        provider: input.provider?.trim().slice(0, 32) || null,
        model: input.model.slice(0, 96),
        background: input.background ?? false,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        characters: Math.max(0, Math.round(input.characters ?? 0)),
        seconds: Math.max(0, Math.ceil(input.seconds ?? 0)),
        costMicros:
          input.costMicros == null
            ? costMicrosFor(input.model, promptTokens, completionTokens)
            : Math.max(0, Math.round(input.costMicros)),
      });
  } catch (err) {
    logger.warn({ err, feature: input.feature }, "Failed to record AI usage");
    if (options.strict) throw err;
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
  const u = (usage ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  return {
    promptTokens: Number(u.prompt_tokens ?? 0),
    completionTokens: Number(u.completion_tokens ?? 0),
  };
}

export const AI_BUDGET_TIMEZONE = "America/New_York";

function timeZoneParts(now: Date): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AI_BUDGET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function offsetAt(now: Date): number {
  const p = timeZoneParts(now);
  return (
    Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) -
    now.getTime()
  );
}

/** Instant corresponding to midnight in America/New_York for the local day. */
export function startOfAiBudgetDay(now: Date = new Date()): Date {
  const p = timeZoneParts(now);
  const midnightAsUtc = Date.UTC(p.year!, p.month! - 1, p.day!);
  let result = new Date(midnightAsUtc - offsetAt(new Date(midnightAsUtc)));
  // Re-evaluate at the resulting instant so DST boundaries remain correct.
  result = new Date(midnightAsUtc - offsetAt(result));
  return result;
}

/** Total spend in USD since midnight America/New_York across all users. */
export async function spendTodayUsd(now: Date = new Date()): Promise<number> {
  try {
    const rows = await getDb()
      .select({ micros: sql<string>`COALESCE(SUM(${aiUsage.costMicros}), 0)` })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, startOfAiBudgetDay(now)));
    return Number(rows[0]?.micros ?? 0) / 1_000_000;
  } catch (err) {
    logger.warn({ err }, "Failed to read today's AI spend");
    throw err;
  }
}

/** Total spend in USD since midnight America/New_York for one user. */
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
          gte(aiUsage.createdAt, startOfAiBudgetDay(now)),
        ),
      );
    return Number(rows[0]?.micros ?? 0) / 1_000_000;
  } catch (err) {
    logger.warn({ err, userId }, "Failed to read user's AI spend");
    throw err;
  }
}

const DEFAULT_BACKGROUND_DAILY_BUDGET_USD = 0.5;

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

/** Install-wide daily cap in USD for background work. Unset/zero uses $0.50. */
export function dailyBudgetUsd(): number {
  return positiveNumber(
    process.env.AI_DAILY_BUDGET_USD,
    DEFAULT_BACKGROUND_DAILY_BUDGET_USD,
  );
}

/** Per-user daily cap in USD for background work. Unset/zero uses $0.50. */
export function backgroundDailyBudgetUsdPerUser(): number {
  return positiveNumber(
    process.env.AI_BACKGROUND_DAILY_BUDGET_USD_PER_USER,
    DEFAULT_BACKGROUND_DAILY_BUDGET_USD,
  );
}

/** Per-user daily cap in USD for Ask. 0 or unset disables the cap. */
export function dailyBudgetUsdPerUser(): number {
  return positiveNumber(
    process.env.AI_DAILY_BUDGET_USD_PER_USER,
    DEFAULT_BACKGROUND_DAILY_BUDGET_USD,
  );
}

export function voiceAskDailyLimit(): number {
  return nonNegativeInteger(process.env.RECALL_VOICE_ASK_DAILY_LIMIT, 30);
}

export function voiceTtsDailyCharacters(): number {
  return nonNegativeInteger(process.env.RECALL_VOICE_TTS_DAILY_CHARS, 15_000);
}

/** Explicit attachment vision OCR calls allowed per user and New York day. */
export function attachmentOcrAiDailyLimit(): number {
  const raw = Number(process.env.RECALL_ATTACHMENT_OCR_AI_DAILY_LIMIT ?? "20");
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 20;
}

export async function attachmentOcrAiCallsToday(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const rows = await getDb()
    .select({ calls: sql<string>`COUNT(*)` })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.userId, userId),
        eq(aiUsage.feature, "attachment_ocr_ai"),
        gte(aiUsage.createdAt, startOfAiBudgetDay(now)),
      ),
    );
  return Number(rows[0]?.calls ?? 0);
}

export type AttachmentOcrAiAllowance =
  | { allowed: true; remaining: number }
  | { allowed: false; reason: "disabled" | "daily_limit" | "unavailable" };

/** Fail closed: paid OCR is off by default and a quota read failure blocks calls. */
export async function allowAttachmentOcrAi(
  userId: string,
): Promise<AttachmentOcrAiAllowance> {
  if (!isEnabled("RECALL_ATTACHMENT_OCR_ENABLED", false)) {
    return { allowed: false, reason: "disabled" };
  }
  const limit = attachmentOcrAiDailyLimit();
  if (limit <= 0) return { allowed: false, reason: "daily_limit" };
  try {
    const calls = await attachmentOcrAiCallsToday(userId);
    if (calls >= limit) return { allowed: false, reason: "daily_limit" };
    return { allowed: true, remaining: limit - calls };
  } catch (err) {
    logger.warn(
      { err, userId },
      "Failed to enforce attachment AI OCR daily limit",
    );
    return { allowed: false, reason: "unavailable" };
  }
}

function featureEnabled(feature: AiFeature): boolean {
  if (!isEnabled("RECALL_BACKGROUND_AI_ENABLED")) return false;
  if (
    feature === "attachment_ocr" &&
    !isEnabled("RECALL_ATTACHMENT_OCR_ENABLED", false)
  ) {
    return false;
  }
  if (feature === "digest" && !isEnabled("RECALL_AI_DIGESTS_ENABLED"))
    return false;
  if (
    feature === "home_digest" &&
    !isEnabled("RECALL_HOME_AI_DIGEST_ENABLED")
  ) {
    return false;
  }
  if (
    feature === "embedding_warm" &&
    !isEnabled("RECALL_EMBEDDING_WARM_ENABLED")
  ) {
    return false;
  }
  if (
    (feature === "deadline_extract" ||
      feature === "waiting_extract" ||
      feature === "waiting_outcome") &&
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
const backgroundUserBudgetCache = new Map<
  string,
  { at: number; spend: number }
>();

export function resetBudgetCacheForTests(): void {
  budgetCache = null;
  userBudgetCache.clear();
  backgroundUserBudgetCache.clear();
}

/**
 * Whether a background model call may proceed. Checks the kill switches first
 * (free) and only then the budget (one cached query per minute).
 */
export async function allowBackgroundAi(
  feature: AiFeature,
  userId?: string | null,
): Promise<boolean> {
  if (!BACKGROUND_FEATURES.has(feature)) return true;
  if (!featureEnabled(feature)) return false;

  const budget = dailyBudgetUsd();
  const now = Date.now();
  try {
    if (!budgetCache || now - budgetCache.at > BUDGET_CACHE_MS) {
      budgetCache = { at: now, spend: await spendTodayUsd() };
    }
    if (budgetCache.spend >= budget) {
      logger.warn(
        { feature, spend: budgetCache.spend, budget },
        "Daily AI budget reached — skipping background work",
      );
      return false;
    }

    if (userId) {
      const userBudget = backgroundDailyBudgetUsdPerUser();
      let cached = backgroundUserBudgetCache.get(userId);
      if (!cached || now - cached.at > BUDGET_CACHE_MS) {
        cached = { at: now, spend: await spendTodayUsdForUser(userId) };
        backgroundUserBudgetCache.set(userId, cached);
      }
      if (cached.spend >= userBudget) {
        logger.warn(
          { feature, userId, spend: cached.spend, budget: userBudget },
          "Per-user background AI budget reached",
        );
        return false;
      }
    }
  } catch (err) {
    logger.warn({ err, feature, userId }, "AI spend guard failed closed");
    return false;
  }
  return true;
}

/**
 * Soft user-facing budget guard. It is intentionally checked before Ask starts
 * so an in-flight streamed response is never interrupted.
 */
export async function allowUserAi(
  feature: AiFeature,
  userId: string,
): Promise<boolean> {
  return (await userAiAllowance(feature, userId)).allowed;
}

export type UserAiAllowance =
  | { allowed: true }
  | { allowed: false; reason: "daily_limit" | "unavailable" };

export async function userAiAllowance(
  feature: AiFeature,
  userId: string,
): Promise<UserAiAllowance> {
  if (feature !== "ask_query") return { allowed: true };
  const budget = dailyBudgetUsdPerUser();

  const now = Date.now();
  let cached = userBudgetCache.get(userId);
  if (!cached || now - cached.at > BUDGET_CACHE_MS) {
    try {
      cached = { at: now, spend: await spendTodayUsdForUser(userId) };
    } catch (err) {
      logger.warn(
        { err, feature, userId },
        "User AI spend guard failed closed",
      );
      return { allowed: false, reason: "unavailable" };
    }
    userBudgetCache.set(userId, cached);
  }
  if (cached.spend < budget) return { allowed: true };

  logger.warn(
    { feature, userId, spend: cached.spend, budget },
    "Per-user daily AI budget reached",
  );
  return { allowed: false, reason: "daily_limit" };
}

export type DailyFeatureUsage = {
  calls: number;
  totalTokens: number;
  characters: number;
  seconds: number;
};

/**
 * Count/token totals for a per-feature guard. Null means accounting could not
 * be read and callers must fail closed.
 */
export async function dailyFeatureUsageForUser(
  userId: string,
  feature: AiFeature,
  now: Date = new Date(),
): Promise<DailyFeatureUsage | null> {
  try {
    const rows = await getDb()
      .select({
        calls: sql<string>`COUNT(*)`,
        totalTokens: sql<string>`COALESCE(SUM(${aiUsage.totalTokens}), 0)`,
        characters: sql<string>`COALESCE(SUM(${aiUsage.characters}), 0)`,
        seconds: sql<string>`COALESCE(SUM(${aiUsage.seconds}), 0)`,
      })
      .from(aiUsage)
      .where(
        and(
          eq(aiUsage.userId, userId),
          eq(aiUsage.feature, feature),
          gte(aiUsage.createdAt, startOfAiBudgetDay(now)),
        ),
      );
    return {
      calls: Number(rows[0]?.calls ?? 0),
      totalTokens: Number(rows[0]?.totalTokens ?? 0),
      characters: Number(rows[0]?.characters ?? 0),
      seconds: Number(rows[0]?.seconds ?? 0),
    };
  } catch (err) {
    logger.warn({ err, userId, feature }, "Failed to read daily feature usage");
    return null;
  }
}

export type VoiceAiAllowance =
  | { allowed: true; remaining: number }
  | {
      allowed: false;
      reason: "disabled" | "daily_limit" | "unavailable";
    };

/**
 * Paid voice calls are fail-closed and checked immediately before each call.
 * The feature-specific cap and the install-wide USD cap both reset at New York
 * midnight. Browser speech/search never call this function.
 */
export async function voiceAiAllowance(
  feature: "voice_ask" | "voice_tts",
  userId: string,
  requestedCharacters = 0,
): Promise<VoiceAiAllowance> {
  if (!isEnabled("RECALL_VOICE_AI_ENABLED", false)) {
    return { allowed: false, reason: "disabled" };
  }

  const limit =
    feature === "voice_ask" ? voiceAskDailyLimit() : voiceTtsDailyCharacters();
  if (limit <= 0) return { allowed: false, reason: "daily_limit" };

  try {
    const [spend, usage] = await Promise.all([
      spendTodayUsd(),
      dailyFeatureUsageForUser(userId, feature),
    ]);
    if (!usage) return { allowed: false, reason: "unavailable" };
    if (spend >= dailyBudgetUsd()) {
      return { allowed: false, reason: "daily_limit" };
    }

    const used = feature === "voice_ask" ? usage.calls : usage.characters;
    const requested =
      feature === "voice_tts"
        ? Math.max(0, Math.round(requestedCharacters))
        : 1;
    if (used + requested > limit) {
      return { allowed: false, reason: "daily_limit" };
    }
    return { allowed: true, remaining: limit - used - requested };
  } catch (err) {
    logger.warn({ err, userId, feature }, "Voice AI spend guard failed closed");
    return { allowed: false, reason: "unavailable" };
  }
}

export type UsageSummaryRow = {
  feature: string;
  model: string;
  calls: number;
  totalTokens: number;
  costUsd: number;
};

export type UsageSummaryDay = {
  /** America/New_York calendar day, YYYY-MM-DD. */
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
        day: sql<string>`TO_CHAR(${aiUsage.createdAt} AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')`,
        calls: sql<string>`COUNT(*)`,
        micros: sql<string>`COALESCE(SUM(${aiUsage.costMicros}), 0)`,
      })
      .from(aiUsage)
      .where(scope)
      .groupBy(
        sql`TO_CHAR(${aiUsage.createdAt} AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')`,
      )
      .orderBy(
        sql`TO_CHAR(${aiUsage.createdAt} AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') DESC`,
      ),
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
    todayUsd: userId
      ? await spendTodayUsdForUser(userId)
      : await spendTodayUsd(),
    budgetUsd: dailyBudgetUsd(),
    rows: mapped,
    daily: daily.map((d) => ({
      date: d.day,
      calls: Number(d.calls),
      costUsd: Number(d.micros) / 1_000_000,
    })),
  };
}
