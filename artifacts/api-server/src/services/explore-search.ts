import { and, eq } from "drizzle-orm";
import { evernoteAttachments } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { freeRetrievalTerms, retrieveRelevantRecords } from "./retrieval";
import {
  listItemsForUser,
  parseItemSearchFilters,
  type SavedItemDto,
} from "./items";

export type ExploreDocument = {
  kind: "recall" | "evernote" | "drive" | "gmail";
  name: string;
  mimeType: string | null;
  previewUrl: string | null;
  downloadUrl: string;
};

export type ExploreSearchResult = {
  id: string;
  entityType: string;
  source: string;
  kind: string;
  title: string;
  snippet: string;
  notebook: string | null;
  date: string | null;
  openUrl: string | null;
  itemId: string | null;
  document: ExploreDocument | null;
};

function sourceLabel(entityType: string, recordType?: string): string {
  switch (recordType) {
    case "evernote_note":
      return "Evernote";
    case "gmail_message":
      return "Gmail";
    case "drive_file":
      return "Drive";
    case "calendar_event":
      return "Calendar";
    case "finance_transaction":
      return "Finance";
  }
  switch (entityType) {
    case "note":
      return "Note";
    case "document":
      return "File";
    case "invoice":
    case "warranty":
      return "Finance";
    default:
      return "Recall";
  }
}

function cleanSnippet(value: string): string {
  return value
    .replace(
      /^(?:email gmail inbox mail message|drive file google doc document|calendar event meeting schedule|evernote note notebook tag personal knowledge|source record)(?:\s+source=\S+)?\s*/i,
      "",
    )
    .replace(/\b(?:sender_name|sender_email|mailbox)=\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function itemSource(item: SavedItemDto): string {
  if (item.source === "evernote") return "Evernote";
  if (["image", "pdf", "file"].includes(item.kind)) return "File";
  if (item.kind === "link") return "Link";
  return "Note";
}

function itemResult(item: SavedItemDto): ExploreSearchResult {
  const hasFile = Boolean(item.media.storagePath);
  const mediaUrl = hasFile
    ? `/api/items/${encodeURIComponent(item.id)}/media`
    : null;
  return {
    id: `item:${item.id}`,
    entityType: "item",
    source: itemSource(item),
    kind: item.kind,
    title: item.title,
    snippet: item.description || item.bodyText,
    notebook: item.notebook,
    date: item.bumpedAt,
    openUrl: item.sourceUrl,
    itemId: item.id,
    document: hasFile
      ? {
          kind: "recall",
          name: item.media.fileName ?? item.title,
          mimeType: item.media.mimeType ?? null,
          previewUrl: mediaUrl,
          downloadUrl: `${mediaUrl}?download=1`,
        }
      : null,
  };
}

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function evernoteDocument(
  userId: string,
  sourceRecordId: string,
): Promise<ExploreDocument | null> {
  const rows = await getDb()
    .select({
      id: evernoteAttachments.id,
      fileName: evernoteAttachments.fileName,
      mime: evernoteAttachments.mime,
    })
    .from(evernoteAttachments)
    .where(
      and(
        eq(evernoteAttachments.userId, userId),
        eq(evernoteAttachments.sourceRecordId, sourceRecordId),
      ),
    )
    .limit(1);
  const attachment = rows[0];
  if (!attachment) return null;
  const mediaUrl = `/api/items/evernote-attachments/${encodeURIComponent(attachment.id)}/media`;
  return {
    kind: "evernote",
    name: attachment.fileName ?? "Evernote attachment",
    mimeType: attachment.mime,
    previewUrl: mediaUrl,
    downloadUrl: `${mediaUrl}?download=1`,
  };
}

export async function searchExploreForUser(
  userId: string,
  rawQuery: string,
  limit = 20,
): Promise<ExploreSearchResult[]> {
  const query = rawQuery.trim().slice(0, 300);
  if (!query) return [];
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
  const terms = freeRetrievalTerms(query);
  const itemQuery = terms.length > 0 ? terms.join(" OR ") : query;
  const [native, retrieval] = await Promise.all([
    listItemsForUser(
      userId,
      parseItemSearchFilters({ q: itemQuery, limit: safeLimit }),
    ).catch(() => []),
    retrieveRelevantRecords(userId, query, safeLimit, {
      noteSearchQuery: query,
      semantic: false,
      sourceScope: "all",
    }),
  ]);

  const results: ExploreSearchResult[] = native.map(itemResult);
  const seen = new Set(results.map((result) => result.id));
  for (const record of retrieval.records) {
    const key = `${record.entityType}:${record.entityId}`;
    if (seen.has(key)) continue;
    const isEvernote =
      record.entityType === "source_record" &&
      record.recordType === "evernote_note";
    const itemId =
      record.entityType === "note"
        ? `note:${record.entityId}`
        : isEvernote
          ? `evernote:${record.entityId}`
          : null;
    const metadata = record.sourceMetadata;
    let document: ExploreDocument | null = null;
    if (isEvernote) {
      document = await evernoteDocument(userId, record.entityId);
    } else if (
      record.entityType === "source_record" &&
      record.recordType === "drive_file" &&
      metadata?.isFolder !== true
    ) {
      const mediaUrl = `/api/items/source-records/${encodeURIComponent(record.entityId)}/media`;
      document = {
        kind: "drive",
        name: record.title,
        mimeType: metadataString(metadata, "mimeType"),
        previewUrl: mediaUrl,
        downloadUrl: `${mediaUrl}?download=1`,
      };
    } else if (record.entityType === "document") {
      document = {
        kind: "recall",
        name: record.title,
        mimeType: metadataString(metadata, "mimeType"),
        previewUrl: null,
        downloadUrl: `/api/documents/${encodeURIComponent(record.entityId)}/download`,
      };
    }
    results.push({
      id: key,
      entityType: record.entityType,
      source: sourceLabel(record.entityType, record.recordType),
      kind: record.recordType ?? record.entityType,
      title: record.title,
      snippet: cleanSnippet(record.text),
      notebook: metadataString(metadata, "notebookName"),
      date: record.updatedAt ?? null,
      openUrl: record.sourceUrl ?? null,
      itemId,
      document,
    });
    seen.add(key);
  }
  return results.slice(0, safeLimit);
}
