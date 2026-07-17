import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  documents,
  homes,
  knowledgeItems,
  notes,
  projects,
  sourceRecords,
  tasks,
  vehicles,
} from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { listLinksFromEntity } from "./entity-links";
import { PROJECT_SOURCE_LINK } from "./project-sources";
import { SUBJECT_EXPENSE_LINK } from "./subject-spend";

export type SubjectTimelineKind =
  | "note"
  | "task"
  | "knowledge"
  | "document"
  | "mail"
  | "transaction"
  | "source";

export type SubjectTimelineItem = {
  at: string;
  kind: SubjectTimelineKind;
  title: string;
  summary: string | null;
  entityType: string;
  entityId: string;
  provenance: string;
  href: string;
};

export type SubjectTimelineSubject = "project" | "vehicle" | "home";

async function subjectExists(
  userId: string,
  subjectType: SubjectTimelineSubject,
  subjectId: string,
): Promise<boolean> {
  if (subjectType === "project") {
    const rows = await getDb()
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, subjectId), eq(projects.userId, userId)))
      .limit(1);
    return Boolean(rows[0]);
  }
  if (subjectType === "vehicle") {
    const rows = await getDb()
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.id, subjectId), eq(vehicles.userId, userId)))
      .limit(1);
    return Boolean(rows[0]);
  }
  const rows = await getDb()
    .select({ id: homes.id })
    .from(homes)
    .where(and(eq(homes.id, subjectId), eq(homes.userId, userId)))
    .limit(1);
  return Boolean(rows[0]);
}

async function loadLinkedSourceItems(
  userId: string,
  sourceIds: string[],
): Promise<SubjectTimelineItem[]> {
  if (sourceIds.length === 0) return [];
  const rows = await getDb()
    .select({
      id: sourceRecords.id,
      recordType: sourceRecords.recordType,
      recordTitle: sourceRecords.recordTitle,
      recordText: sourceRecords.recordText,
      sourceCreatedAt: sourceRecords.sourceCreatedAt,
      updatedAt: sourceRecords.updatedAt,
      recordMetadata: sourceRecords.recordMetadata,
    })
    .from(sourceRecords)
    .where(and(eq(sourceRecords.userId, userId), inArray(sourceRecords.id, sourceIds)));

  return rows.map((row) => {
    const meta = row.recordMetadata ?? {};
    const isFinance = row.recordType === "finance_transaction";
    const isMail =
      row.recordType === "gmail_message" || row.recordType === "outlook_message";
    const amount = typeof meta.amount === "number" ? meta.amount : null;
    const at =
      (typeof meta.date === "string" && meta.date
        ? new Date(`${meta.date}T12:00:00Z`).toISOString()
        : null) ||
      row.sourceCreatedAt?.toISOString() ||
      row.updatedAt.toISOString();
    return {
      at,
      kind: isFinance ? "transaction" : isMail ? "mail" : "source",
      title: row.recordTitle?.trim() || (isFinance ? "Transaction" : "Source"),
      summary: isFinance
        ? [typeof meta.payee === "string" ? meta.payee : null, amount != null ? `$${amount}` : null]
            .filter(Boolean)
            .join(" · ") || null
        : (row.recordText ?? "").slice(0, 140) || null,
      entityType: "source_record",
      entityId: row.id,
      provenance: isFinance
        ? "Linked finance transaction"
        : isMail
          ? "Linked email"
          : `Linked ${row.recordType}`,
      href: isFinance ? "/connectors" : "/ask",
    };
  });
}

export async function getSubjectTimelineForUser(
  userId: string,
  subjectType: SubjectTimelineSubject,
  subjectId: string,
  limit = 40,
): Promise<{ subjectType: SubjectTimelineSubject; subjectId: string; items: SubjectTimelineItem[] } | null> {
  if (!(await subjectExists(userId, subjectType, subjectId))) return null;

  const items: SubjectTimelineItem[] = [];

  if (subjectType === "project") {
    const [noteRows, taskRows, knowledgeRows, docRows, links] = await Promise.all([
      getDb()
        .select({
          id: notes.id,
          title: notes.title,
          preview: notes.preview,
          updatedAt: notes.updatedAt,
        })
        .from(notes)
        .where(and(eq(notes.userId, userId), eq(notes.projectId, subjectId)))
        .orderBy(desc(notes.updatedAt))
        .limit(limit),
      getDb()
        .select({
          id: tasks.id,
          title: tasks.title,
          completed: tasks.completed,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.projectId, subjectId)))
        .orderBy(desc(tasks.updatedAt))
        .limit(limit),
      getDb()
        .select({
          id: knowledgeItems.id,
          title: knowledgeItems.title,
          updatedAt: knowledgeItems.updatedAt,
        })
        .from(knowledgeItems)
        .where(and(eq(knowledgeItems.userId, userId), eq(knowledgeItems.projectId, subjectId)))
        .orderBy(desc(knowledgeItems.updatedAt))
        .limit(limit),
      getDb()
        .select({
          id: documents.id,
          fileName: documents.fileName,
          summary: documents.summary,
          updatedAt: documents.updatedAt,
        })
        .from(documents)
        .where(
          and(
            eq(documents.userId, userId),
            sql`coalesce(${documents.metadata}->>'projectId','') = ${subjectId}`,
          ),
        )
        .orderBy(desc(documents.updatedAt))
        .limit(Math.min(limit, 20)),
      listLinksFromEntity(userId, "project", subjectId, {
        linkType: PROJECT_SOURCE_LINK,
        toEntityType: "source_record",
      }),
    ]);

    for (const n of noteRows) {
      items.push({
        at: n.updatedAt.toISOString(),
        kind: "note",
        title: n.title,
        summary: n.preview?.slice(0, 140) ?? null,
        entityType: "note",
        entityId: n.id,
        provenance: "Project note",
        href: `/notes?note=${encodeURIComponent(n.id)}`,
      });
    }
    for (const t of taskRows) {
      items.push({
        at: t.updatedAt.toISOString(),
        kind: "task",
        title: t.title,
        summary: t.completed ? "Completed" : "Open",
        entityType: "task",
        entityId: t.id,
        provenance: "Project task",
        href: `/tasks?task=${encodeURIComponent(t.id)}`,
      });
    }
    for (const k of knowledgeRows) {
      items.push({
        at: k.updatedAt.toISOString(),
        kind: "knowledge",
        title: k.title,
        summary: null,
        entityType: "knowledge",
        entityId: k.id,
        provenance: "Project knowledge",
        href: `/knowledge?item=${encodeURIComponent(k.id)}`,
      });
    }
    for (const d of docRows) {
      items.push({
        at: d.updatedAt.toISOString(),
        kind: "document",
        title: d.fileName,
        summary: d.summary?.slice(0, 140) ?? null,
        entityType: "document",
        entityId: d.id,
        provenance: "Project document",
        href: `/documents?doc=${encodeURIComponent(d.id)}`,
      });
    }
    items.push(...(await loadLinkedSourceItems(userId, links.map((l) => l.toEntityId))));
  } else {
    // vehicle / home: linked expenses + name-token docs
    const [links, subjectRow] = await Promise.all([
      listLinksFromEntity(userId, subjectType, subjectId, {
        linkType: SUBJECT_EXPENSE_LINK,
        toEntityType: "source_record",
      }),
      subjectType === "vehicle"
        ? getDb()
            .select({ displayName: vehicles.displayName, notes: vehicles.notes })
            .from(vehicles)
            .where(and(eq(vehicles.id, subjectId), eq(vehicles.userId, userId)))
            .limit(1)
        : getDb()
            .select({
              displayName: homes.displayName,
              notes: homes.notes,
              addressLine1: homes.addressLine1,
            })
            .from(homes)
            .where(and(eq(homes.id, subjectId), eq(homes.userId, userId)))
            .limit(1),
    ]);

    items.push(...(await loadLinkedSourceItems(userId, links.map((l) => l.toEntityId))));

    const name = subjectRow[0]?.displayName?.trim();
    if (name && name.length >= 3) {
      const pattern = `%${name.replace(/[%_]/g, "").slice(0, 40)}%`;
      const [noteHits, docHits] = await Promise.all([
        getDb()
          .select({
            id: notes.id,
            title: notes.title,
            preview: notes.preview,
            updatedAt: notes.updatedAt,
          })
          .from(notes)
          .where(
            and(
              eq(notes.userId, userId),
              or(sql`${notes.title} ilike ${pattern}`, sql`${notes.preview} ilike ${pattern}`),
            ),
          )
          .orderBy(desc(notes.updatedAt))
          .limit(15),
        getDb()
          .select({
            id: documents.id,
            fileName: documents.fileName,
            summary: documents.summary,
            updatedAt: documents.updatedAt,
          })
          .from(documents)
          .where(
            and(
              eq(documents.userId, userId),
              or(
                sql`${documents.fileName} ilike ${pattern}`,
                sql`coalesce(${documents.summary},'') ilike ${pattern}`,
                sql`coalesce(${documents.extractedText},'') ilike ${pattern}`,
              ),
            ),
          )
          .orderBy(desc(documents.updatedAt))
          .limit(15),
      ]);
      for (const n of noteHits) {
        items.push({
          at: n.updatedAt.toISOString(),
          kind: "note",
          title: n.title,
          summary: n.preview?.slice(0, 140) ?? null,
          entityType: "note",
          entityId: n.id,
          provenance: `Note mentioning ${name}`,
          href: `/notes?note=${encodeURIComponent(n.id)}`,
        });
      }
      for (const d of docHits) {
        items.push({
          at: d.updatedAt.toISOString(),
          kind: "document",
          title: d.fileName,
          summary: d.summary?.slice(0, 140) ?? null,
          entityType: "document",
          entityId: d.id,
          provenance: `Document mentioning ${name}`,
          href: `/documents?doc=${encodeURIComponent(d.id)}`,
        });
      }
    }
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  return {
    subjectType,
    subjectId,
    items: items.slice(0, limit),
  };
}
