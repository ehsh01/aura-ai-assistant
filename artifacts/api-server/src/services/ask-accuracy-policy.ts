/**
 * Ask accuracy contract: factual domains never invent; High confidence is
 * earned only when required sources succeed and constraints are safe.
 */

export type AskDomain =
  | "finance"
  | "gmail"
  | "drive"
  | "notes"
  | "people"
  | "waiting"
  | "attention"
  | "homey";

export type SourceStatus = "ok" | "empty" | "stale" | "missing" | "auth_error" | "error";

export type SourceConsulted = {
  id: AskDomain | "finance_api" | "google" | string;
  label: string;
  status: SourceStatus;
  detail?: string | null;
  hitCount?: number | null;
};

export type AccuracyVerdict = {
  kind: "high" | "review" | "low";
  confidence: number;
  reason?: string;
};

/** High (≥0.8) only when every required source is ok and constraints are safe. */
export function confidenceFromSources(input: {
  requiredOk: boolean;
  requiredEmptyAfterSafeFilter: boolean;
  stale: boolean;
  connectorMissing: boolean;
  authError: boolean;
  hasGrounding: boolean;
}): AccuracyVerdict {
  if (input.connectorMissing || input.authError) {
    return {
      kind: "low",
      confidence: 0.35,
      reason: input.authError
        ? "A required connector needs re-authorization."
        : "A required connector is not connected.",
    };
  }
  if (input.stale) {
    return {
      kind: "review",
      confidence: 0.55,
      reason: "Source data may be stale.",
    };
  }
  if (!input.requiredOk && !input.requiredEmptyAfterSafeFilter) {
    return {
      kind: "low",
      confidence: 0.4,
      reason: "Required source did not return usable data.",
    };
  }
  if (input.requiredEmptyAfterSafeFilter) {
    return {
      kind: "high",
      confidence: 0.9,
      reason: "No matching records after a safe search.",
    };
  }
  if (input.requiredOk || input.hasGrounding) {
    return { kind: "high", confidence: 0.95 };
  }
  return {
    kind: "low",
    confidence: 0.4,
    reason: "Limited matching records found.",
  };
}

/** Relation words that must never be used as a Gmail from: person. */
export const RELATION_LITERALS = new Set([
  "wife",
  "husband",
  "spouse",
  "son",
  "daughter",
  "sister",
  "brother",
  "mom",
  "mother",
  "dad",
  "father",
  "nephew",
  "niece",
  "aunt",
  "uncle",
  "cousin",
  "boyfriend",
  "girlfriend",
]);

export function isRelationLiteral(name: string | null | undefined): boolean {
  if (!name) return false;
  const first = name.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return RELATION_LITERALS.has(first);
}
