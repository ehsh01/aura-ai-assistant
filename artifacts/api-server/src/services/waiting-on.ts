import { listNoteMetadataForUser } from "./notes";
import { listKnowledgeForUser } from "./knowledge";
import { createPersonForUser, listPeopleForUser } from "./people";
import { createTaskForUser, listTasksForUser, type RecallTaskDto } from "./tasks";
import { createEvidenceForUser } from "./evidence";
import { writeAuditLog } from "./audit";

const WAITING_RE =
  /\b(waiting|follow[- ]?up|awaiting|need(?:s)? (?:a |the )?(?:quote|reply|response|call|email)|still need|pending (?:from|on)|haven't heard|no response)\b/i;

export type WaitingOnItem = {
  id: string;
  person: string;
  personId: string | null;
  item: string;
  days: number;
  href: string;
  followUp: string;
  sourceType: "note" | "knowledge" | "task";
  evidenceText: string;
};

function daysSince(iso?: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function extractPerson(text: string, peopleNames: string[]): string {
  // Prefer known people names that appear in the text.
  const lower = text.toLowerCase();
  for (const name of peopleNames) {
    if (name.length >= 2 && lower.includes(name.toLowerCase())) return name;
  }
  const from = text.match(/\b(?:from|with|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (from?.[1]) return from[1];
  const bare = text.match(/\b([A-Z][a-z]{2,})\b/);
  return bare?.[1] ?? "Someone";
}

function matchPersonId(
  personName: string,
  people: { id: string; displayName: string }[],
): string | null {
  const lower = personName.toLowerCase();
  const hit = people.find(
    (p) =>
      p.displayName.toLowerCase() === lower ||
      p.displayName.toLowerCase().includes(lower) ||
      lower.includes(p.displayName.toLowerCase()),
  );
  return hit?.id ?? null;
}

/**
 * Build a cross-source "waiting on others" list with evidence snippets.
 */
export async function listWaitingOnForUser(
  userId: string,
  limit = 20,
): Promise<WaitingOnItem[]> {
  const [notes, knowledge, people, tasks] = await Promise.all([
    listNoteMetadataForUser(userId),
    listKnowledgeForUser(userId),
    listPeopleForUser(userId),
    listTasksForUser(userId),
  ]);

  const peopleNames = people.map((p) => p.displayName).filter(Boolean);
  const items: WaitingOnItem[] = [];

  for (const n of notes) {
    const blob = `${n.title} ${n.preview}`;
    if (!WAITING_RE.test(blob)) continue;
    const person = extractPerson(blob, peopleNames);
    items.push({
      id: `note:${n.id}`,
      person,
      personId: matchPersonId(person, people),
      item: n.title,
      days: daysSince(n.updatedAt ?? n.createdAt),
      href: `/notes?note=${encodeURIComponent(n.id)}`,
      followUp: `Follow up with ${person}`,
      sourceType: "note",
      evidenceText: blob.slice(0, 280),
    });
  }

  for (const k of knowledge) {
    const blob = `${k.title} ${k.content}`;
    if (!WAITING_RE.test(blob)) continue;
    const person = extractPerson(blob, peopleNames);
    items.push({
      id: `knowledge:${k.id}`,
      person,
      personId: matchPersonId(person, people),
      item: k.title,
      days: daysSince(k.updatedAt ?? k.createdAt),
      href: "/knowledge",
      followUp: `Follow up with ${person}`,
      sourceType: "knowledge",
      evidenceText: blob.slice(0, 280),
    });
  }

  for (const t of tasks.filter((x) => !x.completed && WAITING_RE.test(x.title))) {
    const person = extractPerson(t.title, peopleNames);
    items.push({
      id: `task:${t.id}`,
      person,
      personId: matchPersonId(person, people),
      item: t.title,
      days: 0,
      href: `/tasks?task=${encodeURIComponent(t.id)}`,
      followUp: `Follow up with ${person}`,
      sourceType: "task",
      evidenceText: t.title,
    });
  }

  return items
    .sort((a, b) => b.days - a.days)
    .slice(0, limit);
}

export type FollowUpResult = {
  task: RecallTaskDto;
  personId: string | null;
  waitingItemId: string;
};

/**
 * Turn a waiting-on item into an actionable follow-up task, linked to the
 * person when known and backed by the source evidence text.
 */
export async function createFollowUpFromWaitingOn(
  userId: string,
  waitingItemId: string,
): Promise<FollowUpResult | null> {
  const items = await listWaitingOnForUser(userId, 50);
  const item = items.find((w) => w.id === waitingItemId);
  if (!item) return null;

  // Source tasks already are tasks — don't duplicate; just return a pointer-style result
  // by creating a dedicated "Follow up with X" task unless the item itself is already that.
  let personId = item.personId;
  if (!personId && item.person && item.person !== "Someone") {
    const created = await createPersonForUser(userId, { displayName: item.person });
    personId = created.id;
  }

  const title =
    item.sourceType === "task" && /^follow up/i.test(item.item)
      ? item.item
      : `Follow up with ${item.person}: ${item.item}`.slice(0, 200);

  // Avoid exact-title duplicates among open tasks.
  const open = await listTasksForUser(userId);
  const existing = open.find((t) => !t.completed && t.title === title);
  if (existing) {
    return { task: existing, personId, waitingItemId: item.id };
  }

  const task = await createTaskForUser(userId, {
    title,
    priority: "high",
    tags: ["follow-up", "waiting-on"],
    requesterPersonId: personId,
    aiGenerated: false,
    userConfirmed: true,
  });

  await createEvidenceForUser(userId, {
    entityType: "task",
    entityId: task.id,
    claimType: "task_created_from",
    evidenceText: item.evidenceText.slice(0, 500),
    evidenceMetadata: {
      waitingItemId: item.id,
      sourceType: item.sourceType,
      person: item.person,
      personId,
      sourceHref: item.href,
    },
  });

  await writeAuditLog({
    userId,
    action: "follow_up_created",
    entityType: "task",
    entityId: task.id,
    metadata: {
      title: task.title,
      waitingItemId: item.id,
      person: item.person,
      personId,
      sourceType: item.sourceType,
    },
  });

  return { task, personId, waitingItemId: item.id };
}
