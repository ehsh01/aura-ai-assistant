/**
 * Project context (Phase 5): one grounded aggregation for a project — active
 * tasks, deadlines, waiting items, linked people, blockers, rule-based risks,
 * and a compact decisions trail from the audit log. No invented status: the
 * summary is counts and dates only, and risks only appear when supported by
 * existing data (overdue/at-risk deadlines, overdue follow-ups, blocked
 * tasks).
 */
import {
  getProjectDetailForUser,
  listProjectsForUser,
  type RecallProjectDto,
} from "./projects";
import { listPeopleForUser, type PersonDto } from "./people";
import {
  attentionDueReason,
  listDeadlinesForUser,
  type AttentionItemDto,
} from "./attention";
import { listWaitingItemsForUser, type WaitingItemDto } from "./waiting-items";
import { listAuditForEntities, type AuditEntryDto } from "./audit";
import {
  isWaitingDueForBriefing,
  sourceLabelFor,
  type BriefingAction,
} from "./briefing";
import { computeLinkSuggestions, type LinkSuggestion } from "./link-suggestions";
import { todayIso } from "./query-utils";
import type { RecallTaskDto } from "./tasks";
import type { PersonContextItem } from "./person-context";

export interface ProjectRisk {
  severity: "high" | "medium";
  label: string;
  reason: string;
  href: string;
}

export interface ProjectLinkedPerson {
  id: string | null;
  name: string;
  /** Where the association comes from, e.g. ["tasks", "follow-ups"]. */
  via: string[];
  href: string | null;
}

export interface ProjectDecision {
  at: string;
  label: string;
  detail: string | null;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
}

export interface ProjectContextDto {
  project: RecallProjectDto;
  summary: string;
  stats: {
    openTasks: number;
    deadlinesOpen: number;
    waitingOpen: number;
    notes: number;
    captures: number;
  };
  nextBestAction: BriefingAction | null;
  risks: ProjectRisk[];
  blockers: PersonContextItem[];
  deadlines: PersonContextItem[];
  waitingItems: PersonContextItem[];
  linkedPeople: ProjectLinkedPerson[];
  decisions: ProjectDecision[];
  linkSuggestions: LinkSuggestion[];
}

// ---------------------------------------------------------------------------
// Pure builders
// ---------------------------------------------------------------------------

const BLOCKED_RE = /\bblocked\b/i;

/** Rule-based risks — only from existing dates and unresolved items. */
export function computeProjectRisks(input: {
  attention: AttentionItemDto[];
  waiting: WaitingItemDto[];
  tasks: RecallTaskDto[];
  today: string;
  now: Date;
}): ProjectRisk[] {
  const risks: ProjectRisk[] = [];
  for (const a of input.attention) {
    if (a.status !== "open" && a.status !== "seen") continue;
    const due = attentionDueReason(a, input.now);
    if (due.overdue) {
      risks.push({ severity: "high", label: `Overdue deadline — ${a.title}`, reason: due.label, href: a.href });
    } else if (due.highRisk) {
      risks.push({ severity: "medium", label: `Deadline at risk — ${a.title}`, reason: due.label, href: a.href });
    }
  }
  for (const w of input.waiting) {
    if (w.status !== "open") continue;
    if (w.expectedAt && w.expectedAt.slice(0, 10) < input.today) {
      risks.push({
        severity: "high",
        label: `Follow-up overdue — ${w.deliverable}`,
        reason: `${w.ownerName} expected to deliver by ${w.expectedAt.slice(0, 10)}`,
        href: w.href,
      });
    } else if (isWaitingDueForBriefing(w, input.today)) {
      risks.push({
        severity: "medium",
        label: `Follow-up due — ${w.deliverable}`,
        reason: `Time to check in with ${w.ownerName}`,
        href: w.href,
      });
    }
  }
  for (const t of input.tasks) {
    if (t.completed || !BLOCKED_RE.test(t.title)) continue;
    risks.push({
      severity: "medium",
      label: `Blocked task — ${t.title}`,
      reason: "Marked blocked in the task title",
      href: `/tasks?task=${encodeURIComponent(t.id)}`,
    });
  }
  return risks.sort((a, b) =>
    a.severity === b.severity
      ? a.label.localeCompare(b.label)
      : a.severity === "high"
        ? -1
        : 1,
  );
}

export function buildProjectSummary(stats: ProjectContextDto["stats"], hasHighRisk: boolean): string {
  const parts: string[] = [];
  if (stats.openTasks) parts.push(`${stats.openTasks} open task${stats.openTasks === 1 ? "" : "s"}`);
  if (stats.deadlinesOpen) parts.push(`${stats.deadlinesOpen} open deadline${stats.deadlinesOpen === 1 ? "" : "s"}`);
  if (stats.waitingOpen) parts.push(`${stats.waitingOpen} open follow-up${stats.waitingOpen === 1 ? "" : "s"}`);
  if (parts.length === 0) {
    return "No open work on this project — completed and dismissed items stay in the timeline below.";
  }
  const base = parts.length > 2 ? `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}` : parts.join(" and ");
  return hasHighRisk ? `${base} — needs attention.` : `${base}.`;
}

/** Overdue confirmed deadline → due waiting → high-priority due task. */
export function pickProjectNextAction(input: {
  attention: AttentionItemDto[];
  waiting: WaitingItemDto[];
  tasks: RecallTaskDto[];
  today: string;
  now: Date;
}): BriefingAction | null {
  const overdue = input.attention
    .filter((a) => (a.status === "open" || a.status === "seen") && attentionDueReason(a, input.now).overdue)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  if (overdue.length > 0) {
    const a = overdue[0]!;
    return {
      kind: a.kind === "appointment" ? "appointment" : "deadline",
      id: a.id,
      title: a.title,
      reason: attentionDueReason(a, input.now).label,
      href: a.href,
      sourceLabel: sourceLabelFor(a.sourceEntityType),
    };
  }
  const dueWaiting = input.waiting
    .filter((w) => w.status === "open" && isWaitingDueForBriefing(w, input.today))
    .sort((a, b) => (a.expectedAt ?? a.followUpAt ?? "").localeCompare(b.expectedAt ?? b.followUpAt ?? ""));
  if (dueWaiting.length > 0) {
    const w = dueWaiting[0]!;
    return {
      kind: "waiting",
      id: w.id,
      title: w.deliverable,
      reason: `Follow-up with ${w.ownerName} is due`,
      href: w.href,
      sourceLabel: sourceLabelFor(w.sourceEntityType),
    };
  }
  const hotTask = input.tasks
    .filter((t) => !t.completed && t.priority === "high" && Boolean(t.time) && t.time!.slice(0, 10) <= input.today)
    .sort((a, b) => a.time!.localeCompare(b.time!));
  if (hotTask.length > 0) {
    const t = hotTask[0]!;
    return {
      kind: "task",
      id: t.id,
      title: t.title,
      reason: "High priority — due",
      href: `/tasks?task=${encodeURIComponent(t.id)}`,
      sourceLabel: "Tasks",
    };
  }
  return null;
}

/** Decision-ish audit events (confirmations, completions, dismissals, reply outcomes). */
export function decisionsFromAudit(entries: AuditEntryDto[], limit = 8): ProjectDecision[] {
  const DECISION_ACTIONS =
    /^(attention_(confirmed|completed|dismissed|reopened)|waiting_(item_(completed|dismissed|reopened)|candidate_confirmed|reply_(completed|revised))|task_(completed|reopened)|capture_accepted)$/;
  return entries
    .filter((e) => DECISION_ACTIONS.test(e.action))
    .slice(0, limit)
    .map((e) => ({
      at: e.createdAt,
      label: e.label,
      detail:
        typeof e.metadata.title === "string"
          ? e.metadata.title
          : typeof e.metadata.deliverable === "string"
            ? e.metadata.deliverable
            : null,
      href: e.href,
      entityType: e.entityType,
      entityId: e.entityId,
    }));
}

/** Resolve people linked to a project from every existing association. */
export function buildLinkedPeople(input: {
  project: RecallProjectDto;
  people: PersonDto[];
  tasks: RecallTaskDto[];
  waiting: WaitingItemDto[];
  attention: AttentionItemDto[];
  notePersonIds: (string | null)[];
}): ProjectLinkedPerson[] {
  const viaById = new Map<string, Set<string>>();
  const addVia = (personId: string | null, via: string) => {
    if (!personId) return;
    viaById.set(personId, new Set([...(viaById.get(personId) ?? []), via]));
  };

  for (const ref of input.project.relatedPeople) {
    const person = input.people.find((p) => p.id === ref || p.displayName === ref);
    addVia(person?.id ?? null, "project links");
  }
  for (const t of input.tasks) addVia(t.requesterPersonId, "tasks");
  for (const w of input.waiting) addVia(w.ownerPersonId, "follow-ups");
  for (const a of input.attention) addVia(a.personId, "deadlines");
  for (const id of input.notePersonIds) addVia(id, "notes");

  const linked: ProjectLinkedPerson[] = [...viaById.entries()].map(([id, vias]) => {
    const person = input.people.find((p) => p.id === id);
    return {
      id: person?.id ?? null,
      name: person?.displayName ?? "Unknown person",
      via: [...vias].sort(),
      href: person ? `/people/${encodeURIComponent(person.id)}` : null,
    };
  });

  // Waiting owners we could not resolve to a People row still deserve a row.
  for (const w of input.waiting) {
    if (w.ownerPersonId) continue;
    if (linked.some((p) => p.name.toLowerCase() === w.ownerName.toLowerCase())) continue;
    linked.push({ id: null, name: w.ownerName, via: ["follow-ups"], href: null });
  }

  return linked.sort((a, b) => b.via.length - a.via.length || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function getProjectContextForUser(
  userId: string,
  projectId: string,
): Promise<ProjectContextDto | null> {
  const detail = await getProjectDetailForUser(userId, projectId);
  if (!detail) return null;

  const now = new Date();
  const today = todayIso(now);
  const [allWaiting, deadlines, people, projects] = await Promise.all([
    listWaitingItemsForUser(userId, { status: "all", limit: 100 }),
    listDeadlinesForUser(userId),
    listPeopleForUser(userId),
    listProjectsForUser(userId),
  ]);

  const projectWaiting = allWaiting.filter((w) => w.projectId === projectId);
  const activeWaiting = projectWaiting.filter((w) => w.status === "open" || w.status === "snoozed");

  const attentionAll = [
    ...deadlines.overdue,
    ...deadlines.today,
    ...deadlines.thisWeek,
    ...deadlines.later,
    ...deadlines.unconfirmed,
    ...deadlines.snoozed,
  ];
  const projectAttention = attentionAll.filter((a) => a.projectId === projectId);
  const openAttention = projectAttention.filter((a) => a.status === "open" || a.status === "seen");

  const openTasks = detail.tasks.filter((t) => !t.completed);

  const risks = computeProjectRisks({
    attention: projectAttention,
    waiting: projectWaiting,
    tasks: detail.tasks,
    today,
    now,
  });

  const stats = {
    openTasks: openTasks.length,
    deadlinesOpen: openAttention.length,
    waitingOpen: activeWaiting.length,
    notes: detail.notes.length,
    captures: detail.captures.length,
  };

  const auditRefs = [
    { entityType: "project", entityId: projectId },
    ...projectAttention.map((a) => ({ entityType: "attention_item", entityId: a.id })),
    ...projectWaiting.map((w) => ({ entityType: "waiting_item", entityId: w.id })),
  ];
  const auditEntries = await listAuditForEntities(userId, auditRefs, { limit: 30 });

  const linkSuggestions = computeLinkSuggestions({
    people,
    projects: projects.filter((p) => p.id !== projectId),
    attention: attentionAll,
    waiting: allWaiting,
    tasks: detail.tasks,
    limit: 20,
  }).filter((s) => s.suggestedKind === "project" && s.suggestedId === projectId);

  return {
    project: detail.project,
    summary: buildProjectSummary(stats, risks.some((r) => r.severity === "high")),
    stats,
    nextBestAction: pickProjectNextAction({
      attention: projectAttention,
      waiting: projectWaiting,
      tasks: detail.tasks,
      today,
      now,
    }),
    risks,
    blockers: [
      ...activeWaiting.map((w): PersonContextItem => ({
        kind: "waiting",
        id: w.id,
        title: `${w.deliverable} — ${w.ownerName}`,
        detail: isWaitingDueForBriefing(w, today) ? "Follow-up due" : `Next check ${w.followUpAt?.slice(0, 10) ?? "later"}`,
        at: w.promisedAt,
        href: w.href,
      })),
    ],
    deadlines: openAttention.map((a) => ({
      kind: "deadline",
      id: a.id,
      title: a.title,
      detail: attentionDueReason(a, now).label,
      at: a.dueAt,
      href: a.href,
    })),
    waitingItems: projectWaiting.map((w) => ({
      kind: "waiting",
      id: w.id,
      title: w.deliverable,
      detail: `${w.ownerName} · ${w.status}`,
      at: w.promisedAt,
      href: w.href,
    })),
    linkedPeople: buildLinkedPeople({
      project: detail.project,
      people,
      tasks: detail.tasks,
      waiting: projectWaiting,
      attention: projectAttention,
      notePersonIds: detail.notes.map((n) => n.primaryPersonId),
    }),
    decisions: decisionsFromAudit(auditEntries),
    linkSuggestions,
  };
}
