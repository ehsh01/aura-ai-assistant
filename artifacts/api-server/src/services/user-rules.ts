import { and, asc, eq } from "drizzle-orm";
import { userRules } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newUserRuleId } from "../lib/recall-format";

export type UserRuleDto = {
  id: string;
  body: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const MAX_RULES = 20;
const MAX_BODY = 500;
/** Cap total chars injected into Ask prompts. */
export const USER_RULES_PROMPT_CAP = 1200;

function toDto(row: typeof userRules.$inferSelect): UserRuleDto {
  return {
    id: row.id,
    body: row.body,
    sortOrder: row.sortOrder,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listUserRulesForUser(userId: string): Promise<UserRuleDto[]> {
  const rows = await getDb()
    .select()
    .from(userRules)
    .where(eq(userRules.userId, userId))
    .orderBy(asc(userRules.sortOrder), asc(userRules.createdAt));
  return rows.map(toDto);
}

export async function createUserRuleForUser(
  userId: string,
  body: string,
): Promise<UserRuleDto> {
  const trimmed = body.trim().slice(0, MAX_BODY);
  if (!trimmed) throw new Error("Rule body is required");
  const existing = await listUserRulesForUser(userId);
  if (existing.length >= MAX_RULES) {
    throw new Error(`At most ${MAX_RULES} rules allowed`);
  }
  const now = new Date();
  const [row] = await getDb()
    .insert(userRules)
    .values({
      id: newUserRuleId(),
      userId,
      body: trimmed,
      sortOrder: existing.length,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toDto(row!);
}

export async function updateUserRuleForUser(
  userId: string,
  ruleId: string,
  input: { body?: string; enabled?: boolean; sortOrder?: number },
): Promise<UserRuleDto | null> {
  const [row] = await getDb()
    .update(userRules)
    .set({
      ...(input.body !== undefined ? { body: input.body.trim().slice(0, MAX_BODY) } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(userRules.id, ruleId), eq(userRules.userId, userId)))
    .returning();
  return row ? toDto(row) : null;
}

export async function deleteUserRuleForUser(
  userId: string,
  ruleId: string,
): Promise<boolean> {
  const deleted = await getDb()
    .delete(userRules)
    .where(and(eq(userRules.id, ruleId), eq(userRules.userId, userId)))
    .returning({ id: userRules.id });
  return deleted.length > 0;
}

/** Enabled rules as a single prompt block (capped). */
export async function formatUserRulesForPrompt(userId: string): Promise<string | null> {
  const rules = (await listUserRulesForUser(userId)).filter((r) => r.enabled);
  if (rules.length === 0) return null;
  const lines: string[] = ["User rules (always follow when answering):"];
  let used = lines[0]!.length;
  for (const [i, rule] of rules.entries()) {
    const line = `${i + 1}. ${rule.body}`;
    if (used + line.length + 1 > USER_RULES_PROMPT_CAP) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length > 1 ? lines.join("\n") : null;
}
