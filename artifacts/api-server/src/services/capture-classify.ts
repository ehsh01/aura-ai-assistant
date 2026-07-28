import type { CaptureSuggestedLink } from "@workspace/db/schema";

/** v2 multi-label classification vocabulary (most relevant first). */
export type CaptureTypeLabel =
  | "task"
  | "deadline"
  | "follow_up"
  | "note"
  | "person_update"
  | "project_update"
  | "reference";

const VALID_TYPE_LABELS: ReadonlySet<string> = new Set([
  "task",
  "deadline",
  "follow_up",
  "note",
  "person_update",
  "project_update",
  "reference",
]);

export type LegacySuggestedType =
  | "note"
  | "task"
  | "reminder"
  | "work_note"
  | "project_item"
  | "reference";

/** Keep only valid labels, deduped, preserving order. */
export function normalizeCaptureTypes(
  raw: unknown,
  fallback: CaptureTypeLabel[] = ["note"],
): CaptureTypeLabel[] {
  if (!Array.isArray(raw)) return fallback;
  const out: CaptureTypeLabel[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !VALID_TYPE_LABELS.has(entry)) continue;
    const label = entry as CaptureTypeLabel;
    if (!out.includes(label)) out.push(label);
  }
  return out.length ? out : fallback;
}

/** Map the primary v2 label onto the legacy single-type inbox vocabulary. */
export function primaryTypeToSuggestedType(type: CaptureTypeLabel): LegacySuggestedType {
  switch (type) {
    case "task":
      return "task";
    case "deadline":
      return "reminder";
    case "follow_up":
      return "task";
    case "note":
      return "note";
    case "person_update":
      return "note";
    case "project_update":
      return "project_item";
    case "reference":
      return "reference";
  }
}

/** Inverse of primaryTypeToSuggestedType for legacy rows that lack v2 labels. */
export function suggestedTypeToType(suggestedType: LegacySuggestedType): CaptureTypeLabel {
  switch (suggestedType) {
    case "task":
      return "task";
    case "reminder":
      return "deadline";
    case "work_note":
      return "note";
    case "project_item":
      return "project_update";
    case "reference":
      return "reference";
    case "note":
      return "note";
  }
}

/** Shared confidence bands for extraction records, inbox DTOs, and UI chips. */
export function captureConfidenceLabel(
  score: number | null | undefined,
): "high" | "needs_review" | "uncertain" {
  if (score == null) return "uncertain";
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "needs_review";
  return "uncertain";
}

const AUTO_ACCEPT_MIN_CONFIDENCE = 0.85;
/** Low-risk labels: materializing these is reversible clutter at worst. */
const AUTO_ACCEPT_TYPES: ReadonlySet<CaptureTypeLabel> = new Set(["task", "note", "reference"]);

/**
 * Auto-accept gate: high-confidence, low-risk, nothing time-sensitive, and no
 * unresolved entity names (unmatched people/projects are never auto-created).
 */
export function autoAcceptEligible(input: {
  types: CaptureTypeLabel[];
  confidence: number;
  dueDate: string | null;
  links: CaptureSuggestedLink[];
}): boolean {
  if (input.confidence < AUTO_ACCEPT_MIN_CONFIDENCE) return false;
  if (input.dueDate) return false;
  if (input.types.length === 0 || !input.types.every((t) => AUTO_ACCEPT_TYPES.has(t))) {
    return false;
  }
  return input.links.every((link) => link.matched);
}

/**
 * Pure link matching against injected data — match-only, NEVER creates rows.
 * Unmatched names stay name-only suggestions (`matched: false`, `entityId: null`);
 * creation happens only via the user-confirmed accept flow.
 */
export function matchCaptureLinks(
  input: { personName?: string | null; projectName?: string | null },
  context: {
    projects: { id: string; name: string }[];
    /** Injected person matcher (exact + alias aware); returns null when unknown. */
    matchPerson: (name: string) => string | null;
  },
): CaptureSuggestedLink[] {
  const links: CaptureSuggestedLink[] = [];
  const personName = input.personName?.trim();
  const projectName = input.projectName?.trim();

  if (personName) {
    const matchedId = context.matchPerson(personName);
    links.push({
      entityType: "person",
      entityId: matchedId,
      name: personName,
      matched: matchedId !== null,
      reason: "Mentioned in capture",
    });
  }

  if (projectName) {
    const lower = projectName.toLowerCase();
    const hit = context.projects.find((p) => p.name.trim().toLowerCase() === lower) ?? null;
    links.push({
      entityType: "project",
      entityId: hit?.id ?? null,
      name: projectName,
      matched: hit !== null,
      reason: "Mentioned in capture",
    });
  }

  return links;
}

/** DB-backed wrapper for matchCaptureLinks. Dynamic imports avoid service cycles. */
export async function resolveCaptureLinks(
  userId: string,
  input: { personName?: string | null; projectName?: string | null },
): Promise<CaptureSuggestedLink[]> {
  const { listPeopleForUser } = await import("./people");
  const { listPersonNameAliases } = await import("./user-corrections");
  const { matchPersonId } = await import("./waiting-on");
  const { listProjectsForUser } = await import("./projects");
  const [people, aliases, projects] = await Promise.all([
    listPeopleForUser(userId),
    listPersonNameAliases(userId),
    listProjectsForUser(userId),
  ]);
  return matchCaptureLinks(input, {
    projects,
    matchPerson: (name) => matchPersonId(name, people, aliases),
  });
}
