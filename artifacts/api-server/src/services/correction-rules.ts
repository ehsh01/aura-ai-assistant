/**
 * Compile a user correction into a durable rule body. Pure — callers decide
 * whether to persist. Never invents rules from low-signal edits.
 */

export type CorrectionRuleInput = {
  entityType: string;
  fieldName: string;
  oldValue?: string | null;
  newValue?: string | null;
  reason?: string | null;
};

export function compileCorrectionRule(input: CorrectionRuleInput): string | null {
  const oldValue = input.oldValue?.trim() || "";
  const newValue = input.newValue?.trim() || "";
  const reason = input.reason?.trim() || "";

  if (input.entityType === "person" && input.fieldName === "displayName" && oldValue && newValue) {
    return `When I say "${oldValue}", I mean ${newValue}.`;
  }
  if (input.entityType === "person" && input.fieldName === "email" && oldValue && newValue) {
    return `The email ${oldValue} belongs to the same person as ${newValue}.`;
  }
  if (
    input.entityType === "capture_item" &&
    input.fieldName === "status" &&
    newValue === "dismissed"
  ) {
    if (reason) return `Do not resurface similar captures: ${reason}`;
    if (oldValue) return `I dismissed a ${oldValue} capture — treat similar items as low priority.`;
    return null;
  }
  if (
    input.entityType === "attention_item" &&
    input.fieldName === "status" &&
    newValue === "dismissed" &&
    oldValue
  ) {
    return `"${oldValue}" is not a deadline I want tracked.`;
  }
  if (
    input.entityType === "waiting_item" &&
    input.fieldName === "status" &&
    newValue === "dismissed" &&
    oldValue
  ) {
    return `Do not treat "${oldValue}" as something I am waiting on.`;
  }
  return null;
}

/** Best-effort: persist a compiled rule. Never throws into the caller. */
export async function maybeApplyCorrectionRule(
  userId: string,
  input: CorrectionRuleInput,
): Promise<void> {
  const body = compileCorrectionRule(input);
  if (!body) return;
  try {
    const { createUserRuleForUser, listUserRulesForUser } = await import("./user-rules");
    const existing = await listUserRulesForUser(userId);
    if (existing.some((r) => r.body === body)) return;
    await createUserRuleForUser(userId, body);
  } catch {
    // Rule cap or missing table must not fail the original correction.
  }
}
