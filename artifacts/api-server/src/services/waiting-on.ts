import { listNoteMetadataForUser } from "./notes";
import { listKnowledgeForUser } from "./knowledge";
import { listPeopleForUser } from "./people";
import { listTasksForUser } from "./tasks";

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
