import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { projects, sourceRecords } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import {
  deleteEntityLink,
  listLinksFromEntity,
  upsertEntityLink,
} from "./entity-links";

export const PROJECT_SOURCE_LINK = "reference";

export type ProjectSourceRecord = {
  id: string;
  recordType: string;
  title: string;
  text: string | null;
  date: string | null;
  amount: number | null;
  payee: string | null;
  category: string | null;
};

async function projectOwned(userId: string, projectId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return Boolean(rows[0]);
}

function toSourceDto(row: {
  id: string;
  recordType: string;
  recordTitle: string | null;
  recordText: string | null;
  sourceCreatedAt: Date | null;
  recordMetadata: Record<string, unknown> | null;
}): ProjectSourceRecord {
  const meta = row.recordMetadata ?? {};
  const amountRaw = meta.amount;
  const amount =
    typeof amountRaw === "number"
      ? amountRaw
      : typeof amountRaw === "string"
        ? Number(amountRaw)
        : null;
  return {
    id: row.id,
    recordType: row.recordType,
    title: row.recordTitle?.trim() || "Untitled",
    text: row.recordText,
    date:
      (typeof meta.date === "string" && meta.date) ||
      (row.sourceCreatedAt ? row.sourceCreatedAt.toISOString().slice(0, 10) : null),
    amount: Number.isFinite(amount) ? amount : null,
    payee: typeof meta.payee === "string" ? meta.payee : null,
    category: typeof meta.category === "string" ? meta.category : null,
  };
}

export async function listProjectSourcesForUser(
  userId: string,
  projectId: string,
): Promise<{ mail: ProjectSourceRecord[]; transactions: ProjectSourceRecord[] } | null> {
  if (!(await projectOwned(userId, projectId))) return null;

  const links = await listLinksFromEntity(userId, "project", projectId, {
    linkType: PROJECT_SOURCE_LINK,
    toEntityType: "source_record",
  });
  const ids = links.map((l) => l.toEntityId);
  if (ids.length === 0) return { mail: [], transactions: [] };

  const rows = await getDb()
    .select({
      id: sourceRecords.id,
      recordType: sourceRecords.recordType,
      recordTitle: sourceRecords.recordTitle,
      recordText: sourceRecords.recordText,
      sourceCreatedAt: sourceRecords.sourceCreatedAt,
      recordMetadata: sourceRecords.recordMetadata,
    })
    .from(sourceRecords)
    .where(and(eq(sourceRecords.userId, userId), inArray(sourceRecords.id, ids)));

  const mail: ProjectSourceRecord[] = [];
  const transactions: ProjectSourceRecord[] = [];
  for (const row of rows) {
    const dto = toSourceDto(row);
    if (row.recordType === "finance_transaction") transactions.push(dto);
    else if (row.recordType === "gmail_message" || row.recordType === "outlook_message") {
      mail.push(dto);
    } else {
      mail.push(dto);
    }
  }
  return { mail, transactions };
}

export async function searchSourcesForProjectLink(
  userId: string,
  query: string,
  recordType: "gmail_message" | "finance_transaction",
  limit = 20,
): Promise<ProjectSourceRecord[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const pattern = `%${q.replace(/[%_]/g, "")}%`;
  const rows = await getDb()
    .select({
      id: sourceRecords.id,
      recordType: sourceRecords.recordType,
      recordTitle: sourceRecords.recordTitle,
      recordText: sourceRecords.recordText,
      sourceCreatedAt: sourceRecords.sourceCreatedAt,
      recordMetadata: sourceRecords.recordMetadata,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.recordType, recordType),
        or(
          ilike(sourceRecords.recordTitle, pattern),
          ilike(sourceRecords.recordText, pattern),
          sql`coalesce(${sourceRecords.recordMetadata}->>'payee','') ilike ${pattern}`,
        ),
      ),
    )
    .orderBy(desc(sql`coalesce(${sourceRecords.sourceCreatedAt}, ${sourceRecords.updatedAt})`))
    .limit(limit);

  return rows.map(toSourceDto);
}

export async function linkSourceToProject(
  userId: string,
  projectId: string,
  sourceRecordId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await projectOwned(userId, projectId))) {
    return { ok: false, error: "Project not found" };
  }
  const rows = await getDb()
    .select({ id: sourceRecords.id })
    .from(sourceRecords)
    .where(and(eq(sourceRecords.id, sourceRecordId), eq(sourceRecords.userId, userId)))
    .limit(1);
  if (!rows[0]) return { ok: false, error: "Source record not found" };

  await upsertEntityLink(userId, {
    fromEntityType: "project",
    fromEntityId: projectId,
    toEntityType: "source_record",
    toEntityId: sourceRecordId,
    linkType: PROJECT_SOURCE_LINK,
  });
  return { ok: true };
}

export async function unlinkSourceFromProject(
  userId: string,
  projectId: string,
  sourceRecordId: string,
): Promise<boolean> {
  if (!(await projectOwned(userId, projectId))) return false;
  return deleteEntityLink(userId, {
    fromEntityType: "project",
    fromEntityId: projectId,
    toEntityType: "source_record",
    toEntityId: sourceRecordId,
    linkType: PROJECT_SOURCE_LINK,
  });
}
