import { createHash } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import {
  evernoteAttachments,
  evernoteContainers,
  evernoteSyncState,
  evernoteTags,
  evernoteTasks,
  sourceRecords,
} from "@workspace/db/schema";
import type {
  EvernoteTaxonomy,
  EvernoteTaxonomyEntity,
} from "../connectors/evernote-mcp";
import {
  callEvernoteReadTool,
} from "../connectors/evernote-mcp";
import { getDb } from "../lib/db";
import {
  extractImageTextInMemory,
  extractPdfTextInMemory,
  responseBytesInMemory,
} from "./evernote-attachment-extract";

type ToolCaller = {
  callTool(input: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<unknown>;
};

type JsonRecord = Record<string, unknown>;

function row(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function date(value: unknown): Date | null {
  if (value == null) return null;
  const parsed = new Date(
    typeof value === "number" && value < 10_000_000_000
      ? value * 1_000
      : (value as string | number),
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function stableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 64);
}

function taxonomyValues(
  userId: string,
  connectorId: string,
  kind: "notebook" | "space",
  entity: EvernoteTaxonomyEntity,
) {
  return {
    id: stableId("evernote-container", connectorId, kind, entity.id),
    userId,
    connectorId,
    externalId: entity.id,
    kind,
    name: entity.name,
    parentExternalId: entity.parentId,
    stackName: entity.stack,
    spaceExternalId: entity.spaceId,
    access: entity.access,
    metadata: entity.metadata,
    updatedAt: new Date(),
  };
}

export async function persistEvernoteTaxonomy(
  userId: string,
  connectorId: string,
  taxonomy: EvernoteTaxonomy,
): Promise<void> {
  for (const [kind, entities] of [
    ["notebook", taxonomy.notebooks],
    ["space", taxonomy.spaces],
  ] as const) {
    for (const entity of entities) {
      const values = taxonomyValues(userId, connectorId, kind, entity);
      await getDb()
        .insert(evernoteContainers)
        .values(values)
        .onConflictDoUpdate({
          target: [
            evernoteContainers.connectorId,
            evernoteContainers.externalId,
            evernoteContainers.kind,
          ],
          set: {
            name: values.name,
            parentExternalId: values.parentExternalId,
            stackName: values.stackName,
            spaceExternalId: values.spaceExternalId,
            access: values.access,
            metadata: values.metadata,
            updatedAt: values.updatedAt,
          },
        });
    }
  }
  for (const entity of taxonomy.tags) {
    const values = {
      id: stableId("evernote-tag", connectorId, entity.id),
      userId,
      connectorId,
      externalId: entity.id,
      name: entity.name,
      parentExternalId: entity.parentId,
      metadata: entity.metadata,
      updatedAt: new Date(),
    };
    await getDb()
      .insert(evernoteTags)
      .values(values)
      .onConflictDoUpdate({
        target: [evernoteTags.connectorId, evernoteTags.externalId],
        set: {
          name: values.name,
          parentExternalId: values.parentExternalId,
          metadata: values.metadata,
          updatedAt: values.updatedAt,
        },
      });
  }
  await getDb()
    .insert(evernoteSyncState)
    .values({ connectorId, userId, phase: "notes", updatedAt: new Date() })
    .onConflictDoUpdate({
      target: evernoteSyncState.connectorId,
      set: { updatedAt: new Date() },
    });
}

export async function loadEvernoteTaxonomy(
  connectorId: string,
): Promise<EvernoteTaxonomy | null> {
  const [containers, tags] = await Promise.all([
    getDb()
      .select()
      .from(evernoteContainers)
      .where(eq(evernoteContainers.connectorId, connectorId)),
    getDb()
      .select()
      .from(evernoteTags)
      .where(eq(evernoteTags.connectorId, connectorId)),
  ]);
  if (containers.length === 0 && tags.length === 0) return null;
  const mapContainer = (
    item: (typeof containers)[number],
  ): EvernoteTaxonomyEntity => ({
    id: item.externalId,
    name: item.name,
    parentId: item.parentExternalId,
    stack: item.stackName,
    spaceId: item.spaceExternalId,
    access: item.access,
    metadata: item.metadata,
  });
  return {
    notebooks: containers
      .filter((item) => item.kind === "notebook")
      .map(mapContainer),
    spaces: containers
      .filter((item) => item.kind === "space")
      .map(mapContainer),
    tags: tags.map((item) => ({
      id: item.externalId,
      name: item.name,
      parentId: item.parentExternalId,
      stack: null,
      spaceId: null,
      access: null,
      metadata: item.metadata,
    })),
  };
}

function metadataArray(metadata: JsonRecord, key: string): JsonRecord[] {
  return Array.isArray(metadata[key]) ? metadata[key].map(row) : [];
}

/** Union notebook/tag IDs observed on full notes with name-search enumeration. */
export async function persistEvernoteRecordChildren(input: {
  userId: string;
  connectorId: string;
  sourceRecordId: string;
  sourceUrl: string | null;
  metadata: JsonRecord;
}): Promise<void> {
  const { userId, connectorId, sourceRecordId, sourceUrl, metadata } = input;
  const now = new Date();
  const notebookId = text(metadata.notebookGuid);
  if (notebookId) {
    const name = text(metadata.notebookName) ?? notebookId;
    const values = {
      id: stableId("evernote-container", connectorId, "notebook", notebookId),
      userId,
      connectorId,
      externalId: notebookId,
      kind: "notebook",
      name,
      metadata: { observedOnNote: true },
      updatedAt: now,
    };
    await getDb()
      .insert(evernoteContainers)
      .values(values)
      .onConflictDoUpdate({
        target: [
          evernoteContainers.connectorId,
          evernoteContainers.externalId,
          evernoteContainers.kind,
        ],
        set: { name, updatedAt: now },
      });
  }

  const tagIds = Array.isArray(metadata.tagGuids)
    ? metadata.tagGuids.map(text)
    : [];
  const tagNames = Array.isArray(metadata.tagNames)
    ? metadata.tagNames.map(text)
    : [];
  for (let index = 0; index < tagIds.length; index += 1) {
    const externalId = tagIds[index];
    if (!externalId) continue;
    const name = tagNames[index] ?? externalId;
    await getDb()
      .insert(evernoteTags)
      .values({
        id: stableId("evernote-tag", connectorId, externalId),
        userId,
        connectorId,
        externalId,
        name,
        metadata: { observedOnNote: true },
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [evernoteTags.connectorId, evernoteTags.externalId],
        set: { name, updatedAt: now },
      });
  }

  const attachments = metadataArray(metadata, "attachments");
  const attachmentIds: string[] = [];
  for (const attachment of attachments) {
    const externalId = text(attachment.id);
    if (!externalId) continue;
    attachmentIds.push(externalId);
    const incomingHash = text(attachment.hash);
    await getDb()
      .insert(evernoteAttachments)
      .values({
        id: stableId("evernote-attachment", connectorId, sourceRecordId, externalId),
        userId,
        connectorId,
        sourceRecordId,
        externalId,
        evernoteHash: incomingHash,
        mime: text(attachment.mime),
        fileName: text(attachment.name),
        sizeBytes:
          typeof attachment.sizeBytes === "number"
            ? Math.max(0, Math.floor(attachment.sizeBytes))
            : null,
        sourceUrl,
        metadata: attachment,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          evernoteAttachments.sourceRecordId,
          evernoteAttachments.externalId,
        ],
        set: {
          evernoteHash: incomingHash,
          mime: text(attachment.mime),
          fileName: text(attachment.name),
          sizeBytes:
            typeof attachment.sizeBytes === "number"
              ? Math.max(0, Math.floor(attachment.sizeBytes))
              : null,
          sourceUrl,
          metadata: attachment,
          fetchState: sql`case
            when ${evernoteAttachments.evernoteHash} is distinct from ${incomingHash}
              then 'pending'
            else ${evernoteAttachments.fetchState}
          end`,
          sha256: sql`case
            when ${evernoteAttachments.evernoteHash} is distinct from ${incomingHash}
              then null
            else ${evernoteAttachments.sha256}
          end`,
          extractedText: sql`case
            when ${evernoteAttachments.evernoteHash} is distinct from ${incomingHash}
              then null
            else ${evernoteAttachments.extractedText}
          end`,
          extractedAt: sql`case
            when ${evernoteAttachments.evernoteHash} is distinct from ${incomingHash}
              then null
            else ${evernoteAttachments.extractedAt}
          end`,
          fetchError: sql`case
            when ${evernoteAttachments.evernoteHash} is distinct from ${incomingHash}
              then null
            else ${evernoteAttachments.fetchError}
          end`,
          attempts: sql`case
            when ${evernoteAttachments.evernoteHash} is distinct from ${incomingHash}
              then 0
            else ${evernoteAttachments.attempts}
          end`,
          updatedAt: now,
        },
      });
  }
  await getDb()
    .delete(evernoteAttachments)
    .where(
      attachmentIds.length > 0
        ? and(
            eq(evernoteAttachments.sourceRecordId, sourceRecordId),
            notInArray(evernoteAttachments.externalId, attachmentIds),
          )
        : eq(evernoteAttachments.sourceRecordId, sourceRecordId),
    );

  const tasks = metadataArray(metadata, "tasks");
  const taskIds: string[] = [];
  for (const task of tasks) {
    const taskId = text(task.id) ?? text(task.taskId);
    if (taskId) taskIds.push(taskId);
    await upsertEvernoteTask({
      userId,
      connectorId,
      sourceRecordId,
      defaultNoteExternalId: null,
      task,
    });
  }
  await getDb()
    .delete(evernoteTasks)
    .where(
      taskIds.length > 0
        ? and(
            eq(evernoteTasks.sourceRecordId, sourceRecordId),
            notInArray(evernoteTasks.externalId, taskIds),
          )
        : eq(evernoteTasks.sourceRecordId, sourceRecordId),
    );
}

async function upsertEvernoteTask(input: {
  userId: string;
  connectorId: string;
  sourceRecordId: string | null;
  defaultNoteExternalId: string | null;
  task: JsonRecord;
}): Promise<void> {
  const externalId = text(input.task.id) ?? text(input.task.taskId);
  if (!externalId) return;
  const values = {
    id: stableId("evernote-task", input.connectorId, externalId),
    userId: input.userId,
    connectorId: input.connectorId,
    sourceRecordId: input.sourceRecordId,
    noteExternalId:
      text(input.task.noteId) ?? input.defaultNoteExternalId,
    externalId,
    label: text(input.task.label) ?? "",
    description: text(input.task.description),
    status: text(input.task.status),
    dueAt: date(input.task.dueDate ?? input.task.dueAt),
    completedAt: date(input.task.completedAt),
    sourceUpdatedAt: date(input.task.updatedAt ?? input.task.updated),
    priority: text(input.task.priority),
    flagged: bool(input.task.flagged),
    recurring: bool(input.task.recurring),
    assignee: text(input.task.assignee),
    metadata: input.task,
    updatedAt: new Date(),
  };
  await getDb()
    .insert(evernoteTasks)
    .values(values)
    .onConflictDoUpdate({
      target: [evernoteTasks.connectorId, evernoteTasks.externalId],
      set: {
        sourceRecordId: values.sourceRecordId,
        noteExternalId: values.noteExternalId,
        label: values.label,
        description: values.description,
        status: values.status,
        dueAt: values.dueAt,
        completedAt: values.completedAt,
        sourceUpdatedAt: values.sourceUpdatedAt,
        priority: values.priority,
        flagged: values.flagged,
        recurring: values.recurring,
        assignee: values.assignee,
        metadata: values.metadata,
        updatedAt: values.updatedAt,
      },
    });
}

function firstArray(root: JsonRecord, keys: string[]): unknown[] {
  for (const key of keys) if (Array.isArray(root[key])) return root[key] as unknown[];
  const data = row(root.data);
  for (const key of keys) if (Array.isArray(data[key])) return data[key] as unknown[];
  return [];
}

function attachmentDownloadUrl(result: JsonRecord): string | null {
  for (const candidate of [
    result.downloadUrl,
    result.signedUrl,
    result.url,
    row(result.attachment).downloadUrl,
    row(result.attachment).signedUrl,
    row(result.attachment).url,
    row(result.data).downloadUrl,
    row(result.data).url,
  ]) {
    const value = text(candidate);
    if (value && isAllowedEvernoteAttachmentUrl(value)) return value;
  }
  return null;
}

export function isAllowedEvernoteAttachmentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    const configured = (process.env.EVERNOTE_ATTACHMENT_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const allowed = [
      "storage.googleapis.com",
      "googleusercontent.com",
      "evernote.com",
      ...configured,
    ];
    return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function fetchEvernoteAttachmentUrl(value: string): Promise<Response> {
  let url = value;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!isAllowedEvernoteAttachmentUrl(url)) {
      throw new Error("Evernote attachment URL host is not allowlisted");
    }
    const response = await fetch(url, { redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Evernote attachment redirect has no location");
    url = new URL(location, url).toString();
  }
  throw new Error("Evernote attachment exceeded redirect limit");
}

export async function processOneEvernoteAttachment(
  client: ToolCaller,
  connectorId: string,
): Promise<boolean> {
  const [attachment] = await getDb()
    .select()
    .from(evernoteAttachments)
    .where(
      and(
        eq(evernoteAttachments.connectorId, connectorId),
        eq(evernoteAttachments.fetchState, "pending"),
      ),
    )
    .orderBy(asc(evernoteAttachments.createdAt))
    .limit(1);
  if (!attachment) return false;
  await getDb()
    .update(evernoteAttachments)
    .set({
      fetchState: "fetching",
      attempts: attachment.attempts + 1,
      fetchError: null,
      updatedAt: new Date(),
    })
    .where(eq(evernoteAttachments.id, attachment.id));

  try {
    const result = await callEvernoteReadTool(client, "get_attachment", {
      attachmentId: attachment.externalId,
    });
    const downloadUrl = attachmentDownloadUrl(result);
    if (!downloadUrl) throw new Error("Evernote get_attachment returned no download URL");
    const { data, sha256 } = await responseBytesInMemory(
      await fetchEvernoteAttachmentUrl(downloadUrl),
    );
    const [duplicate] = await getDb()
      .select({
        extractedText: evernoteAttachments.extractedText,
        textEngine: evernoteAttachments.textEngine,
      })
      .from(evernoteAttachments)
      .where(
        and(
          eq(evernoteAttachments.connectorId, connectorId),
          eq(evernoteAttachments.sha256, sha256),
          eq(evernoteAttachments.fetchState, "complete"),
          ne(evernoteAttachments.id, attachment.id),
        ),
      )
      .limit(1);
    let extractedText = duplicate?.extractedText ?? "";
    let textEngine = duplicate?.textEngine ?? null;
    if (!duplicate) {
      const mime = (attachment.mime ?? "").toLowerCase();
      const name = (attachment.fileName ?? "").toLowerCase();
      if (mime === "application/pdf" || name.endsWith(".pdf")) {
        extractedText = await extractPdfTextInMemory(data);
        textEngine = "pdf-parse";
      } else if (
        mime.startsWith("image/") ||
        /\.(?:jpe?g|png|gif|webp|bmp|tiff?|heic)$/i.test(name)
      ) {
        if (data.length >= 20 * 1024) {
          extractedText = await extractImageTextInMemory(data);
          textEngine = "tesseract";
        }
      }
    }
    await getDb()
      .update(evernoteAttachments)
      .set({
        sha256,
        sizeBytes: data.length,
        extractedText,
        textEngine,
        fetchState: "complete",
        fetchError: null,
        extractedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(evernoteAttachments.id, attachment.id));
  } catch (error) {
    await getDb()
      .update(evernoteAttachments)
      .set({
        fetchState: "failed",
        fetchError:
          error instanceof Error ? error.message.slice(0, 1_000) : "Attachment fetch failed",
        updatedAt: new Date(),
      })
      .where(eq(evernoteAttachments.id, attachment.id));
  }
  return true;
}

export async function processEvernoteTaskPage(input: {
  client: ToolCaller;
  userId: string;
  connectorId: string;
  cursor: string | null;
}): Promise<{ complete: boolean; nextCursor: string | null; count: number }> {
  const result = await callEvernoteReadTool(input.client, "search_tasks", {
    assigneeScope: "all",
    maxResults: 50,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    completedAfter: "2000-01-01T00:00:00.000Z",
  });
  const tasks = firstArray(result, ["tasks", "results", "items"]).map(row);
  for (const task of tasks) {
    const noteExternalId = text(task.noteId);
    let sourceRecordId: string | null = null;
    if (noteExternalId) {
      const [source] = await getDb()
        .select({ id: sourceRecords.id })
        .from(sourceRecords)
        .where(
          and(
            eq(sourceRecords.connectorId, input.connectorId),
            eq(sourceRecords.externalId, noteExternalId),
          ),
        )
        .limit(1);
      sourceRecordId = source?.id ?? null;
    }
    await upsertEvernoteTask({
      userId: input.userId,
      connectorId: input.connectorId,
      sourceRecordId,
      defaultNoteExternalId: noteExternalId,
      task,
    });
  }
  const nextCursor =
    text(result.nextCursor) ??
    text(result.cursor) ??
    text(row(result.pageInfo).nextCursor);
  return {
    complete: !nextCursor || nextCursor === input.cursor || tasks.length === 0,
    nextCursor,
    count: tasks.length,
  };
}

export async function verifyOneEvernoteNotebook(
  client: ToolCaller,
  connectorId: string,
  offset: number,
): Promise<boolean> {
  const [notebook] = await getDb()
    .select()
    .from(evernoteContainers)
    .where(
      and(
        eq(evernoteContainers.connectorId, connectorId),
        eq(evernoteContainers.kind, "notebook"),
      ),
    )
    .orderBy(asc(evernoteContainers.name), asc(evernoteContainers.externalId))
    .offset(offset)
    .limit(1);
  if (!notebook) return false;
  const result = await callEvernoteReadTool(client, "search_notes", {
    query: `nbGuid:"${notebook.externalId.replaceAll('"', "")}"`,
    maxResults: 1,
    startIndex: 0,
  });
  const expected = Number(
    result.totalResultCount ?? result.total ?? result.totalNotes,
  );
  await getDb()
    .update(evernoteContainers)
    .set({
      expectedNoteCount: Number.isFinite(expected) ? Math.max(0, expected) : null,
      updatedAt: new Date(),
    })
    .where(eq(evernoteContainers.id, notebook.id));
  return true;
}

export async function syncEvernoteReminderFlags(
  client: ToolCaller,
  connectorId: string,
): Promise<number> {
  const ids = new Set<string>();
  let startIndex = 0;
  let expectedTotal: number | null = null;
  for (;;) {
    const result = await callEvernoteReadTool(client, "search_notes", {
      query: "reminderOrder:*",
      maxResults: 100,
      startIndex,
      sortBy: "updated",
      ascending: false,
    });
    const page = firstArray(result, ["notes", "results", "items"]);
    for (const item of page) {
      const value = row(item);
      const id = text(value.id) ?? text(value.guid) ?? text(value.noteId);
      if (id) ids.add(id);
    }
    const reportedTotal = Number(
      result.totalResultCount ?? result.total ?? result.totalNotes,
    );
    if (Number.isFinite(reportedTotal)) expectedTotal = reportedTotal;
    startIndex += page.length;
    if (
      page.length === 0 ||
      page.length < 100 ||
      (expectedTotal != null && startIndex >= expectedTotal)
    ) {
      break;
    }
    const paceMs = Math.min(
      10_000,
      Math.max(0, Number(process.env.EVERNOTE_MCP_PACE_MS ?? 1_000) || 0),
    );
    if (paceMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, paceMs));
    }
  }
  await getDb()
    .update(sourceRecords)
    .set({
      recordMetadata: sql`coalesce(${sourceRecords.recordMetadata}, '{}'::jsonb) || '{"hasReminder":false}'::jsonb`,
    })
    .where(eq(sourceRecords.connectorId, connectorId));
  if (ids.size > 0) {
    await getDb()
      .update(sourceRecords)
      .set({
        recordMetadata: sql`coalesce(${sourceRecords.recordMetadata}, '{}'::jsonb) || '{"hasReminder":true}'::jsonb`,
      })
      .where(
        and(
          eq(sourceRecords.connectorId, connectorId),
          inArray(sourceRecords.externalId, [...ids]),
        ),
      );
  }
  return ids.size;
}

export type EvernoteCompletenessReport = {
  generatedAt: string;
  complete: boolean;
  pass: boolean;
  totals: {
    evernoteNotes: number;
    recallNotes: number;
    missing: number;
    trashedEvernoteNotes: number;
    trashedRecallNotes: number;
    trashedMissing: number;
    attachmentsExpected: number;
    attachmentsStored: number;
    tasksExpected: number;
    tasksStored: number;
  };
  notebooks: Array<{
    id: string;
    notebook: string;
    stack: string | null;
    spaceId: string | null;
    evernoteNotes: number;
    recallNotes: number;
    missing: number;
    attachmentsExpected: number;
    attachmentsStored: number;
    tasksExpected: number;
    tasksStored: number;
    verified: boolean;
  }>;
};

type NotebookCountRow = {
  notebook_id: string;
  recall_notes: number | string;
  attachments_expected: number | string;
  attachments_stored: number | string;
  tasks_expected: number | string;
  tasks_stored: number | string;
};

export function calculateEvernoteReport(
  notebooks: Array<{
    id: string;
    notebook: string;
    stack: string | null;
    spaceId: string | null;
    evernoteNotes: number;
    recallNotes: number;
    attachmentsExpected: number;
    attachmentsStored: number;
    tasksExpected: number;
    tasksStored: number;
    verified?: boolean;
  }>,
  options?: {
    expectedTrashCount?: number | null;
    recallTrashCount?: number;
    expectedTaskCount?: number | null;
    storedTaskCount?: number;
    requireExternalTotals?: boolean;
  },
): EvernoteCompletenessReport {
  const rows = notebooks.map((item) => ({
    ...item,
    missing: Math.max(0, item.evernoteNotes - item.recallNotes),
    verified: item.verified !== false,
  }));
  const notebookTotals = rows.reduce<{
    evernoteNotes: number;
    recallNotes: number;
    missing: number;
    attachmentsExpected: number;
    attachmentsStored: number;
    tasksExpected: number;
    tasksStored: number;
  }>(
    (sum, item) => ({
      evernoteNotes: sum.evernoteNotes + item.evernoteNotes,
      recallNotes: sum.recallNotes + item.recallNotes,
      missing: sum.missing + item.missing,
      attachmentsExpected:
        sum.attachmentsExpected + item.attachmentsExpected,
      attachmentsStored: sum.attachmentsStored + item.attachmentsStored,
      tasksExpected: sum.tasksExpected + item.tasksExpected,
      tasksStored: sum.tasksStored + item.tasksStored,
    }),
    {
      evernoteNotes: 0,
      recallNotes: 0,
      missing: 0,
      attachmentsExpected: 0,
      attachmentsStored: 0,
      tasksExpected: 0,
      tasksStored: 0,
    },
  );
  const trashedEvernoteNotes = Math.max(0, options?.expectedTrashCount ?? 0);
  const trashedRecallNotes = Math.max(0, options?.recallTrashCount ?? 0);
  const trashedMissing = Math.max(0, trashedEvernoteNotes - trashedRecallNotes);
  const totals = {
    ...notebookTotals,
    evernoteNotes: notebookTotals.evernoteNotes + trashedEvernoteNotes,
    recallNotes: notebookTotals.recallNotes + trashedRecallNotes,
    missing: notebookTotals.missing + trashedMissing,
    trashedEvernoteNotes,
    trashedRecallNotes,
    trashedMissing,
    tasksExpected:
      options?.expectedTaskCount ?? notebookTotals.tasksExpected,
    tasksStored: options?.storedTaskCount ?? notebookTotals.tasksStored,
  };
  const complete =
    rows.every((item) => item.verified) &&
    (!options?.requireExternalTotals ||
      (options.expectedTrashCount != null &&
        options.expectedTaskCount != null));
  return {
    generatedAt: new Date().toISOString(),
    complete,
    pass:
      complete &&
      totals.missing === 0 &&
      totals.attachmentsStored === totals.attachmentsExpected &&
      totals.tasksStored === totals.tasksExpected,
    totals,
    notebooks: rows,
  };
}

export async function buildEvernoteCompletenessReport(
  userId: string,
  connectorId: string,
  external?: {
    expectedTrashCount: number | null;
    expectedTaskCount: number | null;
  },
): Promise<EvernoteCompletenessReport> {
  const containers = await getDb()
    .select()
    .from(evernoteContainers)
    .where(
      and(
        eq(evernoteContainers.userId, userId),
        eq(evernoteContainers.connectorId, connectorId),
        eq(evernoteContainers.kind, "notebook"),
      ),
    )
    .orderBy(asc(evernoteContainers.name));
  const result = await getDb().execute(sql`
    SELECT
      sr.record_metadata->>'notebookGuid' AS notebook_id,
      cast(count(*) AS int) AS recall_notes,
      cast(coalesce(sum(jsonb_array_length(coalesce(sr.record_metadata->'attachments', '[]'::jsonb))), 0) AS int)
        AS attachments_expected,
      cast(coalesce(sum((
        select count(*) from evernote_attachments ea
        where ea.source_record_id = sr.id and ea.fetch_state = 'complete'
      )), 0) AS int)
        AS attachments_stored,
      cast(coalesce(sum((
        select count(*) from evernote_tasks expected_task
        where expected_task.connector_id = sr.connector_id
          and expected_task.note_external_id = sr.external_id
      )), 0) AS int)
        AS tasks_expected,
      cast(coalesce(sum((
        select count(*) from evernote_tasks et
        where et.source_record_id = sr.id
      )), 0) AS int)
        AS tasks_stored
    FROM source_records sr
    WHERE sr.user_id = ${userId}
      AND sr.connector_id = ${connectorId}
      AND sr.record_type = 'evernote_note'
      AND coalesce((sr.record_metadata->>'trashed')::boolean, false) = false
    GROUP BY sr.record_metadata->>'notebookGuid'
  `);
  const countRows = (
    (result as unknown as { rows?: unknown[] }).rows ??
    (Array.isArray(result) ? result : [])
  ) as NotebookCountRow[];
  const counts = new Map(
    countRows.map((item) => [item.notebook_id, item] as const),
  );
  const [trashCountResult, taskCountResult, taskExpectedResult] = await Promise.all([
    getDb().execute(sql`
      SELECT cast(count(*) as int) AS count
      FROM source_records
      WHERE user_id = ${userId}
        AND connector_id = ${connectorId}
        AND record_type = 'evernote_note'
        AND coalesce((record_metadata->>'trashed')::boolean, false) = true
    `),
    getDb().execute(sql`
      SELECT cast(count(*) as int) AS count
      FROM evernote_tasks
      WHERE user_id = ${userId} AND connector_id = ${connectorId}
    `),
    getDb().execute(sql`
      SELECT cast(count(*) as int) AS count
      FROM (
        SELECT task->>'id' AS external_id
        FROM source_records sr
        CROSS JOIN LATERAL jsonb_array_elements(
          coalesce(sr.record_metadata->'tasks', '[]'::jsonb)
        ) task
        WHERE sr.user_id = ${userId}
          AND sr.connector_id = ${connectorId}
          AND task->>'id' IS NOT NULL
        UNION
        SELECT external_id
        FROM evernote_tasks
        WHERE user_id = ${userId} AND connector_id = ${connectorId}
      ) expected_tasks
    `),
  ]);
  const resultCount = (value: unknown): number => {
    const rows =
      (value as { rows?: Array<Record<string, unknown>> })?.rows ?? [];
    return Number(rows[0]?.count ?? 0);
  };
  const report = calculateEvernoteReport(
    containers.map((container) => {
      const count = counts.get(container.externalId);
      return {
        id: container.externalId,
        notebook: container.name,
        stack: container.stackName,
        spaceId: container.spaceExternalId,
        evernoteNotes:
          container.expectedNoteCount ?? Number(count?.recall_notes ?? 0),
        recallNotes: Number(count?.recall_notes ?? 0),
        attachmentsExpected: Number(count?.attachments_expected ?? 0),
        attachmentsStored: Number(count?.attachments_stored ?? 0),
        tasksExpected: Number(count?.tasks_expected ?? 0),
        tasksStored: Number(count?.tasks_stored ?? 0),
        verified: container.expectedNoteCount != null,
      };
    }),
    {
      expectedTrashCount: external?.expectedTrashCount ?? null,
      recallTrashCount: resultCount(trashCountResult),
      expectedTaskCount:
        external?.expectedTaskCount == null
          ? null
          : Math.max(
              external.expectedTaskCount,
              resultCount(taskExpectedResult),
            ),
      storedTaskCount: resultCount(taskCountResult),
      requireExternalTotals: true,
    },
  );
  await getDb()
    .insert(evernoteSyncState)
    .values({
      connectorId,
      userId,
      phase: "complete",
      report,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: evernoteSyncState.connectorId,
      set: { phase: "complete", report, updatedAt: new Date() },
    });
  return report;
}

export async function getEvernoteCompletenessReport(
  userId: string,
  connectorId: string,
): Promise<EvernoteCompletenessReport | null> {
  const [state] = await getDb()
    .select({ report: evernoteSyncState.report })
    .from(evernoteSyncState)
    .where(
      and(
        eq(evernoteSyncState.userId, userId),
        eq(evernoteSyncState.connectorId, connectorId),
      ),
    )
    .limit(1);
  return state?.report && Object.keys(state.report).length > 0
    ? (state.report as EvernoteCompletenessReport)
    : null;
}

export type EvernoteSearchFilters = {
  q?: string;
  type?: string;
  createdFrom?: Date;
  createdTo?: Date;
  updatedFrom?: Date;
  updatedTo?: Date;
  tag?: string;
  notebook?: string;
  source?: string;
  trash?: boolean;
  limit?: number;
};

export async function searchEvernoteRecords(
  userId: string,
  connectorId: string,
  filters: EvernoteSearchFilters,
) {
  const conditions = [
    eq(sourceRecords.userId, userId),
    eq(sourceRecords.connectorId, connectorId),
    eq(sourceRecords.recordType, "evernote_note"),
    filters.trash
      ? sql`coalesce((${sourceRecords.recordMetadata}->>'trashed')::boolean, false) = true`
      : sql`coalesce((${sourceRecords.recordMetadata}->>'trashed')::boolean, false) = false`,
  ];
  if (filters.source && filters.source !== "evernote") return [];
  if (filters.createdFrom) {
    conditions.push(sql`${sourceRecords.sourceCreatedAt} >= ${filters.createdFrom}`);
  }
  if (filters.createdTo) {
    conditions.push(sql`${sourceRecords.sourceCreatedAt} <= ${filters.createdTo}`);
  }
  if (filters.updatedFrom) {
    conditions.push(sql`${sourceRecords.sourceUpdatedAt} >= ${filters.updatedFrom}`);
  }
  if (filters.updatedTo) {
    conditions.push(sql`${sourceRecords.sourceUpdatedAt} <= ${filters.updatedTo}`);
  }
  if (filters.tag) {
    conditions.push(
      sql`${sourceRecords.recordMetadata}->'tagNames' @> ${JSON.stringify([
        filters.tag,
      ])}::jsonb`,
    );
  }
  if (filters.notebook) {
    conditions.push(
      sql`lower(coalesce(${sourceRecords.recordMetadata}->>'notebookName', '')) = lower(${filters.notebook})`,
    );
  }
  const type = filters.type?.toLowerCase();
  if (type === "task") {
    conditions.push(
      sql`exists (select 1 from evernote_tasks et where et.source_record_id = ${sourceRecords.id})`,
    );
  } else if (type === "pdf") {
    conditions.push(
      sql`exists (select 1 from evernote_attachments ea where ea.source_record_id = ${sourceRecords.id} and ea.mime = 'application/pdf')`,
    );
  } else if (type === "image") {
    conditions.push(
      sql`exists (select 1 from evernote_attachments ea where ea.source_record_id = ${sourceRecords.id} and ea.mime like 'image/%')`,
    );
  } else if (type === "attachment") {
    conditions.push(
      sql`exists (select 1 from evernote_attachments ea where ea.source_record_id = ${sourceRecords.id})`,
    );
  }
  const terms = (filters.q ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2)
    .slice(0, 10);
  const tsQuery = terms.map((term) => `${term}:*`).join(" & ");
  if (tsQuery) {
    conditions.push(
      sql`(
        ${sourceRecords.searchTsv} @@ to_tsquery('simple', ${tsQuery})
        OR exists (
          select 1 from evernote_attachments ea
          where ea.source_record_id = ${sourceRecords.id}
            and ea.search_tsv @@ to_tsquery('simple', ${tsQuery})
        )
      )`,
    );
  }
  return getDb()
    .select({
      id: sourceRecords.id,
      externalId: sourceRecords.externalId,
      title: sourceRecords.recordTitle,
      text: sourceRecords.recordText,
      sourceUrl: sourceRecords.sourceUrl,
      sourceCreatedAt: sourceRecords.sourceCreatedAt,
      sourceUpdatedAt: sourceRecords.sourceUpdatedAt,
      metadata: sourceRecords.recordMetadata,
    })
    .from(sourceRecords)
    .where(and(...conditions))
    .orderBy(sql`${sourceRecords.sourceUpdatedAt} desc nulls last`)
    .limit(Math.min(Math.max(filters.limit ?? 50, 1), 100));
}

export async function resetInterruptedEvernoteAttachments(
  connectorId: string,
  resetTerminalFailures = false,
): Promise<void> {
  await getDb()
    .update(evernoteAttachments)
    .set({ fetchState: "pending", updatedAt: new Date() })
    .where(
      and(
        eq(evernoteAttachments.connectorId, connectorId),
        or(
          and(
            eq(evernoteAttachments.fetchState, "fetching"),
            lt(
              evernoteAttachments.updatedAt,
              new Date(Date.now() - 15 * 60_000),
            ),
          ),
          and(
            eq(evernoteAttachments.fetchState, "failed"),
            resetTerminalFailures
              ? sql`true`
              : lt(evernoteAttachments.attempts, 3),
          ),
        ),
      ),
    );
}
