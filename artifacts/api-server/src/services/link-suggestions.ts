/**
 * Cross-entity link suggestions (Phase 5).
 *
 * Pure, compute-on-read: finds records that mention a known person/project by
 * name but lack the corresponding link field, and suggests the link with a
 * confidence level. Nothing is created here — confirming a suggestion applies
 * an ordinary PATCH to the existing record (audited by that record's flow),
 * and people/projects are never auto-created.
 */
import type { AttentionItemDto } from "./attention";
import { listDeadlinesForUser, patchAttentionItemForUser } from "./attention";
import type { WaitingItemDto } from "./waiting-items";
import { listWaitingItemsForUser, patchWaitingItemForUser } from "./waiting-items";
import type { RecallTaskDto } from "./tasks";
import { listTasksForUser, updateTaskForUser } from "./tasks";
import type { RecallProjectDto } from "./projects";
import { getProjectDetailForUser, listProjectsForUser } from "./projects";
import type { PersonDto } from "./people";
import { getPersonForUser, listPeopleForUser } from "./people";
import { listPersonNameAliases } from "./user-corrections";
import { writeAuditLog } from "./audit";
import { matchPersonId } from "./waiting-on";

export type LinkSuggestionEntityType = "attention_item" | "waiting_item" | "task";
export type LinkSuggestionField = "personId" | "ownerPersonId" | "requesterPersonId" | "projectId";

export interface LinkSuggestion {
  /** Stable fingerprint `${entityType}:${entityId}:${field}:${suggestedId}` — used for dismissals. */
  id: string;
  entityType: LinkSuggestionEntityType;
  entityId: string;
  title: string;
  field: LinkSuggestionField;
  suggestedKind: "person" | "project";
  suggestedId: string;
  suggestedName: string;
  confidence: "high" | "medium";
  /** Plain-language "why Aura suggested this". */
  reason: string;
  href: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 2 = full name appears as whole words; 1 = every name part appears as whole
 * words (in any position); 0 = no usable match.
 */
export function nameMatchStrength(name: string, text: string): 0 | 1 | 2 {
  const trimmed = name.trim();
  if (!trimmed || !text) return 0;
  if (new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "i").test(text)) return 2;
  const parts = trimmed.split(/\s+/).filter((p) => p.length >= 3);
  if (parts.length >= 2 && parts.every((p) => new RegExp(`\\b${escapeRegExp(p)}\\b`, "i").test(text))) {
    return 1;
  }
  return 0;
}

function suggestionFor(input: {
  entityType: LinkSuggestionEntityType;
  entityId: string;
  title: string;
  field: LinkSuggestionField;
  suggestedKind: "person" | "project";
  suggestedId: string;
  suggestedName: string;
  strength: 1 | 2;
  matchedOn: string;
  href: string;
}): LinkSuggestion {
  return {
    id: `${input.entityType}:${input.entityId}:${input.field}:${input.suggestedId}`,
    entityType: input.entityType,
    entityId: input.entityId,
    title: input.title.slice(0, 160),
    field: input.field,
    suggestedKind: input.suggestedKind,
    suggestedId: input.suggestedId,
    suggestedName: input.suggestedName,
    confidence: input.strength === 2 ? "high" : "medium",
    reason:
      input.strength === 2
        ? `"${input.suggestedName}" appears in the ${input.matchedOn}`
        : `Parts of "${input.suggestedName}" appear in the ${input.matchedOn}`,
    href: input.href,
  };
}

/**
 * Compute link suggestions across entity types. Only active records are
 * considered; terminal/done records never produce suggestions.
 */
export function computeLinkSuggestions(input: {
  people: PersonDto[];
  aliases?: Map<string, string>;
  projects: RecallProjectDto[];
  attention: AttentionItemDto[];
  waiting: WaitingItemDto[];
  tasks: RecallTaskDto[];
  limit?: number;
}): LinkSuggestion[] {
  const limit = input.limit ?? 20;
  const people = input.people.map((p) => ({ id: p.id, displayName: p.displayName }));
  const out: LinkSuggestion[] = [];

  // Waiting items: owner name matched a known person but the link is missing.
  for (const w of input.waiting) {
    if (w.status !== "open" && w.status !== "snoozed") continue;
    if (w.ownerPersonId) continue;
    const personId = matchPersonId(w.ownerName, people, input.aliases);
    if (!personId) continue;
    const personName = people.find((p) => p.id === personId)?.displayName ?? w.ownerName;
    out.push(
      suggestionFor({
        entityType: "waiting_item",
        entityId: w.id,
        title: w.deliverable,
        field: "ownerPersonId",
        suggestedKind: "person",
        suggestedId: personId,
        suggestedName: personName,
        strength: nameMatchStrength(personName, w.ownerName) === 2 ? 2 : 1,
        matchedOn: "owner name",
        href: w.href,
      }),
    );
  }

  // Attention items: person/project name in title or evidence, link missing.
  for (const a of input.attention) {
    if (a.status !== "open" && a.status !== "seen") continue;
    const haystack = `${a.title}\n${a.evidenceText ?? ""}`;
    if (!a.personId) {
      const personId = matchPersonId(a.title, people, input.aliases) ?? matchPersonId(a.evidenceText ?? "", people, input.aliases);
      if (personId) {
        const personName = people.find((p) => p.id === personId)?.displayName ?? "";
        const strength = nameMatchStrength(personName, haystack);
        if (strength !== 0) {
          out.push(
            suggestionFor({
              entityType: "attention_item",
              entityId: a.id,
              title: a.title,
              field: "personId",
              suggestedKind: "person",
              suggestedId: personId,
              suggestedName: personName,
              strength,
              matchedOn: "title or source excerpt",
              href: a.href,
            }),
          );
        }
      }
    }
    if (!a.projectId) {
      for (const project of input.projects) {
        if (project.status !== "active") continue;
        if (nameMatchStrength(project.name, haystack) !== 2) continue;
        out.push(
          suggestionFor({
            entityType: "attention_item",
            entityId: a.id,
            title: a.title,
            field: "projectId",
            suggestedKind: "project",
            suggestedId: project.id,
            suggestedName: project.name,
            strength: 2,
            matchedOn: "title or source excerpt",
            href: a.href,
          }),
        );
        break; // one project suggestion per record
      }
    }
  }

  // Tasks: requester person / project name in title, link missing.
  for (const t of input.tasks) {
    if (t.completed) continue;
    if (!t.requesterPersonId) {
      const personId = matchPersonId(t.title, people, input.aliases);
      if (personId) {
        const personName = people.find((p) => p.id === personId)?.displayName ?? "";
        const strength = nameMatchStrength(personName, t.title);
        if (strength !== 0) {
          out.push(
            suggestionFor({
              entityType: "task",
              entityId: t.id,
              title: t.title,
              field: "requesterPersonId",
              suggestedKind: "person",
              suggestedId: personId,
              suggestedName: personName,
              // Task titles are short and noisy — a partial match is weak here.
              strength: strength === 2 ? 2 : 1,
              matchedOn: "task title",
              href: `/tasks?task=${encodeURIComponent(t.id)}`,
            }),
          );
        }
      }
    }
    if (!t.projectId) {
      for (const project of input.projects) {
        if (project.status !== "active") continue;
        if (nameMatchStrength(project.name, t.title) !== 2) continue;
        out.push(
          suggestionFor({
            entityType: "task",
            entityId: t.id,
            title: t.title,
            field: "projectId",
            suggestedKind: "project",
            suggestedId: project.id,
            suggestedName: project.name,
            strength: 2,
            matchedOn: "task title",
            href: `/tasks?task=${encodeURIComponent(t.id)}`,
          }),
        );
        break;
      }
    }
  }

  // High-confidence first, then stable order by id for determinism.
  return out
    .sort((a, b) =>
      a.confidence === b.confidence
        ? a.id.localeCompare(b.id)
        : a.confidence === "high"
          ? -1
          : 1,
    )
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Orchestration + confirm/dismiss
// ---------------------------------------------------------------------------

export async function listLinkSuggestionsForUser(userId: string, limit = 20): Promise<LinkSuggestion[]> {
  const [people, aliases, projects, deadlines, waiting, tasks] = await Promise.all([
    listPeopleForUser(userId),
    listPersonNameAliases(userId),
    listProjectsForUser(userId),
    listDeadlinesForUser(userId),
    listWaitingItemsForUser(userId, { status: "active", limit: 100 }),
    listTasksForUser(userId),
  ]);
  const attentionAll = [
    ...deadlines.overdue,
    ...deadlines.today,
    ...deadlines.thisWeek,
    ...deadlines.later,
    ...deadlines.unconfirmed,
  ];
  return computeLinkSuggestions({
    people,
    aliases,
    projects,
    attention: attentionAll,
    waiting,
    tasks,
    limit,
  });
}

const ALLOWED_FIELDS: Record<LinkSuggestionEntityType, LinkSuggestionField[]> = {
  attention_item: ["personId", "projectId"],
  waiting_item: ["ownerPersonId", "projectId"],
  task: ["requesterPersonId", "projectId"],
};

/**
 * Apply a confirmed suggestion through the target record's ordinary PATCH
 * flow (so its own audit/validation rules still run), then audit the link
 * confirmation itself. Returns false when the record or link target is not
 * found for this user.
 */
export async function confirmLinkSuggestionForUser(
  userId: string,
  input: {
    entityType: LinkSuggestionEntityType;
    entityId: string;
    field: LinkSuggestionField;
    value: string;
  },
): Promise<boolean> {
  if (!ALLOWED_FIELDS[input.entityType]?.includes(input.field)) return false;

  // Never link to another user's (or a nonexistent) person/project.
  const targetIsPerson = input.field !== "projectId";
  const target = targetIsPerson
    ? await getPersonForUser(userId, input.value)
    : await getProjectDetailForUser(userId, input.value);
  if (!target) return false;

  let applied: unknown = null;
  if (input.entityType === "attention_item") {
    applied = await patchAttentionItemForUser(userId, input.entityId, { [input.field]: input.value });
  } else if (input.entityType === "waiting_item") {
    applied = await patchWaitingItemForUser(userId, input.entityId, { [input.field]: input.value });
  } else {
    applied = await updateTaskForUser(userId, input.entityId, { [input.field]: input.value });
  }
  if (!applied) return false;

  await writeAuditLog({
    userId,
    action: "link_suggestion_confirmed",
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: {
      field: input.field,
      value: input.value,
      targetKind: targetIsPerson ? "person" : "project",
      targetName: targetIsPerson ? (target as PersonDto).displayName : (target as { project: RecallProjectDto }).project.name,
    },
  });
  return true;
}

/** Dismissals are tracked client-side; the audit row keeps them accountable. */
export async function dismissLinkSuggestionForUser(
  userId: string,
  input: {
    id: string;
    entityType: string;
    entityId: string;
    suggestedName: string;
  },
): Promise<void> {
  await writeAuditLog({
    userId,
    action: "link_suggestion_dismissed",
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: { suggestionId: input.id, suggestedName: input.suggestedName },
  });
}
