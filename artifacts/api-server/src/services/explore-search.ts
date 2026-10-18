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
          previewUrl: canPreviewDocumentMime(item.media.mimeType)
            ? mediaUrl
            : null,
          downloadUrl: `${mediaUrl}?download=1`,
        }
      : null,
  };
}

function canPreviewDocumentMime(mimeType: string | null | undefined): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  return (
    mime === "application/pdf" ||
    mime === "text/plain" ||
    /^image\/(?:avif|bmp|gif|jpe?g|png|webp)$/.test(mime) ||
    /^application\/vnd\.google-apps\.(?:document|drawing|presentation|spreadsheet)$/.test(
      mime,
    )
  );
}

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function gmailDocument(
  sourceRecordId: string,
  metadata: Record<string, unknown> | null | undefined,
): ExploreDocument | null {
  const values = Array.isArray(metadata?.attachments)
    ? metadata.attachments
    : [];
  const attachment = values.find(
    (value) =>
      value &&
      typeof value === "object" &&
      typeof (value as { id?: unknown }).id === "string",
  ) as
    | {
        id: string;
        fileName?: unknown;
        mimeType?: unknown;
      }
    | undefined;
  if (!attachment) return null;
  const mimeType =
    typeof attachment.mimeType === "string" ? attachment.mimeType : null;
  const mediaUrl =
    `/api/items/source-records/${encodeURIComponent(sourceRecordId)}` +
    `/gmail-attachments/${encodeURIComponent(attachment.id)}/media`;
  return {
    kind: "gmail",
    name:
      typeof attachment.fileName === "string"
        ? attachment.fileName
        : "Gmail attachment",
    mimeType,
    previewUrl: canPreviewDocumentMime(mimeType) ? mediaUrl : null,
    downloadUrl: `${mediaUrl}?download=1`,
  };
}

async function evernoteDocument(
  userId: string,
  sourceRecordId: string,
  preferredAttachmentId?: string | null,
): Promise<ExploreDocument | null> {
  const clauses = [
    eq(evernoteAttachments.userId, userId),
    eq(evernoteAttachments.sourceRecordId, sourceRecordId),
  ];
  if (preferredAttachmentId) {
    clauses.push(eq(evernoteAttachments.id, preferredAttachmentId));
  }
  const rows = await getDb()
    .select({
      id: evernoteAttachments.id,
      fileName: evernoteAttachments.fileName,
      mime: evernoteAttachments.mime,
    })
    .from(evernoteAttachments)
    .where(
      and(...clauses),
    )
    .limit(1);
  const attachment = rows[0];
  if (!attachment) return null;
  const mediaUrl = `/api/items/evernote-attachments/${encodeURIComponent(attachment.id)}/media`;
  return {
    kind: "evernote",
    name: attachment.fileName ?? "Evernote attachment",
    mimeType: attachment.mime,
    previewUrl: canPreviewDocumentMime(attachment.mime) ? mediaUrl : null,
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

  const nativeResults = native.map(itemResult);
  const retrievalResults: ExploreSearchResult[] = [];
  for (const record of retrieval.records) {
    const key = `${record.entityType}:${record.entityId}`;
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
      document = await evernoteDocument(
        userId,
        record.entityId,
        metadataString(metadata, "matchedAttachmentId"),
      );
    } else if (
      record.entityType === "source_record" &&
      record.recordType === "gmail_message"
    ) {
      document = gmailDocument(record.entityId, metadata);
    } else if (
      record.entityType === "source_record" &&
      record.recordType === "drive_file" &&
      metadata?.isFolder !== true &&
      metadataString(metadata, "mimeType") !==
        "application/vnd.google-apps.folder"
    ) {
      const mediaUrl = `/api/items/source-records/${encodeURIComponent(record.entityId)}/media`;
      document = {
        kind: "drive",
        name: record.title,
        mimeType: metadataString(metadata, "mimeType"),
        previewUrl: canPreviewDocumentMime(
          metadataString(metadata, "mimeType"),
        )
          ? mediaUrl
          : null,
        downloadUrl: `${mediaUrl}?download=1`,
      };
    } else if (
      record.entityType === "document" &&
      metadataString(metadata, "storagePath")
    ) {
      const mediaUrl = `/api/items/documents/${encodeURIComponent(record.entityId)}/media`;
      const mimeType = metadataString(metadata, "mimeType");
      document = {
        kind: "recall",
        name: record.title,
        mimeType,
        previewUrl: canPreviewDocumentMime(mimeType) ? mediaUrl : null,
        downloadUrl: `${mediaUrl}?download=1`,
      };
    }
    retrievalResults.push({
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
  }

  const canonicalKey = (result: ExploreSearchResult): string => {
    if (result.itemId?.startsWith("note:")) return result.itemId;
    if (result.itemId?.startsWith("evernote:")) return result.itemId;
    if (
      result.entityType === "source_record" &&
      result.kind === "evernote_note"
    ) {
      return `evernote:${result.id.slice(result.id.indexOf(":") + 1)}`;
    }
    return result.id;
  };
  const merged: ExploreSearchResult[] = [];
  const seen = new Set<string>();
  const append = (result: ExploreSearchResult | undefined) => {
    if (!result) return;
    const key = canonicalKey(result);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(result);
  };
  const length = Math.max(nativeResults.length, retrievalResults.length);
  for (let index = 0; index < length && merged.length < safeLimit; index += 1) {
    append(retrievalResults[index]);
    if (merged.length < safeLimit) append(nativeResults[index]);
  }
  return merged;
}
