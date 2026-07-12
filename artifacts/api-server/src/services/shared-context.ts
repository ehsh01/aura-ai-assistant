import { and, eq, inArray } from "drizzle-orm";
import {
  knowledgeItems,
  lifeMemories,
  notes,
  tasks,
} from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { attachmentSearchTextForNotes } from "./attachment-text-extract";
import {
  linkedEntityKeySet,
  listEntitiesLinkedToPeople,
  type LinkedEntityRef,
} from "./entity-links";
import { noteRetrievalText } from "./note-retrieval";
import { personNamesById } from "./person-tags";

/** Minimal record shape for Ask corpus injection / shared context. */
export type SharedContextRecord = {
  entityType: string;
  entityId: string;
  title: string;
  text: string;
  pinned?: boolean;
};

const HYDRATE_LIMIT = 40;

function idsForType(links: LinkedEntityRef[], entityType: string): string[] {
  return [...new Set(links.filter((l) => l.entityType === entityType).map((l) => l.entityId))];
}

/**
 * Load note/knowledge/memory/task records linked to the given people via
 * entity_links — including older items outside Ask corpus recency caps.
 */
export async function loadLinkedContextRecordsForPeople(
  userId: string,
  personIds: string[],
  opts?: { limit?: number; excludeKeys?: Set<string> },
): Promise<{ links: LinkedEntityRef[]; records: SharedContextRecord[] }> {
  const links = await listEntitiesLinkedToPeople(userId, personIds);
  if (links.length === 0) return { links, records: [] };

  const exclude = opts?.excludeKeys ?? new Set<string>();
  const limit = opts?.limit ?? HYDRATE_LIMIT;
  const missing = links.filter((l) => !exclude.has(`${l.entityType}:${l.entityId}`));
  if (missing.length === 0) return { links, records: [] };

  const noteIds = idsForType(missing, "note").slice(0, limit);
  const knowledgeIds = idsForType(missing, "knowledge").slice(0, limit);
  const memoryIds = idsForType(missing, "memory").slice(0, limit);
  const taskIds = idsForType(missing, "task").slice(0, limit);

  const [noteRows, knowledgeRows, memoryRows, taskRows, attachmentText] =
    await Promise.all([
      noteIds.length === 0
        ? Promise.resolve([])
        : getDb()
            .select({
              id: notes.id,
              title: notes.title,
              content: notes.content,
              preview: notes.preview,
              tags: notes.tags,
              primaryPersonId: notes.primaryPersonId,
            })
            .from(notes)
            .where(and(eq(notes.userId, userId), inArray(notes.id, noteIds))),
      knowledgeIds.length === 0
        ? Promise.resolve([])
        : getDb()
            .select({
              id: knowledgeItems.id,
              title: knowledgeItems.title,
              content: knowledgeItems.content,
              tags: knowledgeItems.tags,
              primaryPersonId: knowledgeItems.primaryPersonId,
            })
            .from(knowledgeItems)
            .where(
              and(
                eq(knowledgeItems.userId, userId),
                inArray(knowledgeItems.id, knowledgeIds),
              ),
            ),
      memoryIds.length === 0
        ? Promise.resolve([])
        : getDb()
            .select({
              id: lifeMemories.id,
              title: lifeMemories.title,
              content: lifeMemories.content,
              domain: lifeMemories.domain,
              tags: lifeMemories.tags,
              primaryPersonId: lifeMemories.primaryPersonId,
              pinned: lifeMemories.pinned,
            })
            .from(lifeMemories)
            .where(
              and(eq(lifeMemories.userId, userId), inArray(lifeMemories.id, memoryIds)),
            ),
      taskIds.length === 0
        ? Promise.resolve([])
        : getDb()
            .select({
              id: tasks.id,
              title: tasks.title,
              priority: tasks.priority,
              time: tasks.time,
              completed: tasks.completed,
              requesterPersonId: tasks.requesterPersonId,
            })
            .from(tasks)
            .where(and(eq(tasks.userId, userId), inArray(tasks.id, taskIds))),
      noteIds.length === 0
        ? Promise.resolve(new Map<string, string>())
        : attachmentSearchTextForNotes(noteIds),
    ]);

  const personNameIds = [
    ...noteRows.map((r) => r.primaryPersonId),
    ...knowledgeRows.map((r) => r.primaryPersonId),
    ...memoryRows.map((r) => r.primaryPersonId),
    ...taskRows.map((r) => r.requesterPersonId),
  ].filter((id): id is string => Boolean(id));
  const names = await personNamesById(userId, personNameIds);

  const records: SharedContextRecord[] = [];

  for (const n of noteRows) {
    const personName = n.primaryPersonId ? names.get(n.primaryPersonId) ?? null : null;
    records.push({
      entityType: "note",
      entityId: n.id,
      title: n.title,
      text: noteRetrievalText({
        title: n.title,
        content: n.content,
        preview: n.preview,
        tags: n.tags,
        attachmentText: attachmentText.get(n.id) ?? "",
        primaryPersonId: n.primaryPersonId,
        primaryPersonName: personName,
      }),
    });
  }

  for (const k of knowledgeRows) {
    const personName = k.primaryPersonId ? names.get(k.primaryPersonId) ?? null : null;
    const personBits = [personName, k.primaryPersonId].filter(Boolean).join(" ");
    records.push({
      entityType: "knowledge",
      entityId: k.id,
      title: k.title,
      text: `${k.title}\n${(k.content ?? "").slice(0, 600)}\ntags=${(k.tags ?? []).join(",")}${
        personBits ? ` person=${personBits}` : ""
      }`,
    });
  }

  for (const m of memoryRows) {
    const personName = m.primaryPersonId ? names.get(m.primaryPersonId) ?? null : null;
    const cap = m.pinned ? 4000 : 1200;
    records.push({
      entityType: "memory",
      entityId: m.id,
      title: m.title,
      text: `domain=${m.domain} ${m.title}\n${m.content.slice(0, cap)}\ntags=${(m.tags ?? []).join(",")}${
        m.primaryPersonId ? ` personId=${m.primaryPersonId}` : ""
      }${personName ? ` person=${personName}` : ""}${m.pinned ? " pinned=true" : ""}`,
      pinned: m.pinned,
    });
  }

  for (const t of taskRows) {
    const personName = t.requesterPersonId ? names.get(t.requesterPersonId) ?? null : null;
    const personBits = [personName, t.requesterPersonId].filter(Boolean).join(" ");
    records.push({
      entityType: "task",
      entityId: t.id,
      title: t.title,
      text: `${t.title} priority=${t.priority} due=${t.time ?? "none"} completed=${t.completed}${
        personBits ? ` person=${personBits}` : ""
      }`,
    });
  }

  return { links, records: records.slice(0, limit) };
}

export function mergeSharedContextIntoCorpus<T extends SharedContextRecord>(
  corpus: T[],
  linked: SharedContextRecord[],
): T[] {
  if (linked.length === 0) return corpus;
  const seen = new Set(corpus.map((r) => `${r.entityType}:${r.entityId}`));
  const extra = linked.filter((r) => {
    const key = `${r.entityType}:${r.entityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }) as T[];
  return extra.length === 0 ? corpus : [...corpus, ...extra];
}

/** Group linked refs by entity type (pure helper for tests / callers). */
export function groupLinkedEntityIds(
  links: LinkedEntityRef[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const link of links) {
    const list = out[link.entityType] ?? [];
    if (!list.includes(link.entityId)) list.push(link.entityId);
    out[link.entityType] = list;
  }
  return out;
}

export { linkedEntityKeySet, listEntitiesLinkedToPeople };
