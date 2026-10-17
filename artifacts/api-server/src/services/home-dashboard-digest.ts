import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { aiResultCache } from "@workspace/db/schema";
import { getDb, isDatabaseConfigured } from "../lib/db";
import { logger } from "../lib/logger";
import {
  aiService,
  type DashboardDigestRequest,
  type DashboardDigestResponse,
} from "./ai";
import {
  allowBackgroundAi,
  dailyFeatureUsageForUser,
  withAiFeature,
} from "./ai-usage";

const FEATURE = "home_digest" as const;
const PROMPT_VERSION = "home-dashboard-digest-v1";
const DEFAULT_DAILY_LIMIT = 3;

export function homeDigestDailyLimit(): number {
  const value = Number(process.env.RECALL_HOME_AI_DIGEST_DAILY_LIMIT);
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_DAILY_LIMIT;
}

export function homeDigestInputHash(request: DashboardDigestRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({ promptVersion: PROMPT_VERSION, request }))
    .digest("hex");
}

function parseCachedResult(value: unknown): DashboardDigestResponse | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.digest !== "string" || !Array.isArray(row.highlights))
    return null;
  return {
    digest: row.digest,
    highlights: row.highlights.filter(
      (item): item is string => typeof item === "string",
    ),
    degraded: Boolean(row.degraded),
    degradedReason:
      typeof row.degradedReason === "string" ? row.degradedReason : null,
  };
}

/**
 * Generate at most once for a user/input hash. A deterministic result is
 * inserted first, so provider errors and concurrent reloads remain fail-closed.
 */
export async function getHomeDashboardDigest(
  userId: string,
  request: DashboardDigestRequest,
  deterministic: DashboardDigestResponse,
): Promise<DashboardDigestResponse> {
  if (!isDatabaseConfigured()) return deterministic;

  const inputHash = homeDigestInputHash(request);
  try {
    const existing = await getDb()
      .select({ result: aiResultCache.result })
      .from(aiResultCache)
      .where(
        and(
          eq(aiResultCache.userId, userId),
          eq(aiResultCache.feature, FEATURE),
          eq(aiResultCache.inputHash, inputHash),
        ),
      )
      .limit(1);
    const cached = parseCachedResult(existing[0]?.result);
    if (cached) return cached;

    if (!(await allowBackgroundAi(FEATURE, userId))) return deterministic;
    const usage = await dailyFeatureUsageForUser(userId, FEATURE);
    if (!usage || usage.calls >= homeDigestDailyLimit()) return deterministic;

    const claimed = await getDb()
      .insert(aiResultCache)
      .values({
        userId,
        feature: FEATURE,
        inputHash,
        result: deterministic as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning({ id: aiResultCache.id });

    if (claimed.length === 0) {
      const raced = await getDb()
        .select({ result: aiResultCache.result })
        .from(aiResultCache)
        .where(
          and(
            eq(aiResultCache.userId, userId),
            eq(aiResultCache.feature, FEATURE),
            eq(aiResultCache.inputHash, inputHash),
          ),
        )
        .limit(1);
      return parseCachedResult(raced[0]?.result) ?? deterministic;
    }

    try {
      const generated = await withAiFeature({ feature: FEATURE, userId }, () =>
        aiService.dashboardDigest(request),
      );
      const result: DashboardDigestResponse = {
        digest: generated.digest?.trim() || deterministic.digest,
        highlights: generated.highlights ?? [],
        degraded: generated.degraded,
        degradedReason: generated.degradedReason ?? null,
      };
      await getDb()
        .update(aiResultCache)
        .set({
          result: result as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(aiResultCache.id, claimed[0]!.id));
      return result;
    } catch (err) {
      logger.warn({ err, userId }, "Home dashboard digest failed closed");
      return deterministic;
    }
  } catch (err) {
    logger.warn({ err, userId }, "Home dashboard digest cache unavailable");
    return deterministic;
  }
}
