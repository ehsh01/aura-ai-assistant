import { and, eq } from "drizzle-orm";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  connectors,
  documents,
  evernoteAttachments,
  sourceRecords,
} from "@workspace/db/schema";
import {
  fetchDriveFileDownload,
  fetchGmailAttachmentDownload,
} from "../connectors/google";
import { fetchEvernoteResourceData } from "../connectors/evernote";
import { withEvernoteMcpClient } from "../connectors/evernote-mcp";
import { getDb } from "../lib/db";
import { config } from "../lib/config";
import {
  openConnectorSettings,
  sealConnectorSettings,
} from "../lib/secret-box";
import {
  fetchEvernoteAttachmentUrl,
  getEvernoteAttachmentDownloadUrl,
} from "./evernote-full-sync";
import { ensureGoogleAccessToken } from "./connectors";

export type OwnerDocumentResponse = {
  response?: Response;
  path?: string;
  fileName: string;
  mimeType: string;
};

function safeName(value: string | null | undefined, fallback: string): string {
  return (value?.trim() || fallback).replace(/[\r\n"]/g, "_").slice(0, 220);
}

export async function getEvernoteAttachmentForUser(
  userId: string,
  attachmentId: string,
): Promise<OwnerDocumentResponse | null> {
  const rows = await getDb()
    .select({
      attachment: evernoteAttachments,
      noteExternalId: sourceRecords.externalId,
      connector: connectors,
    })
    .from(evernoteAttachments)
    .innerJoin(
      sourceRecords,
      eq(sourceRecords.id, evernoteAttachments.sourceRecordId),
    )
    .innerJoin(connectors, eq(connectors.id, evernoteAttachments.connectorId))
    .where(
      and(
        eq(evernoteAttachments.id, attachmentId),
        eq(evernoteAttachments.userId, userId),
        eq(sourceRecords.userId, userId),
        eq(connectors.userId, userId),
        eq(connectors.enabled, true),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row?.attachment.evernoteHash) return null;
  const settings = openConnectorSettings(
    (row.connector.settings ?? {}) as Record<string, unknown>,
  );
  let response: Response;
  if (settings.authTransport === "mcp") {
    const persisted = async (next: Record<string, unknown>) => {
      await getDb()
        .update(connectors)
        .set({
          settings: sealConnectorSettings({ ...settings, ...next }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(connectors.id, row.connector.id),
            eq(connectors.userId, userId),
          ),
        );
    };
    const fetched = await withEvernoteMcpClient(
      settings,
      async (client) => {
        const url = await getEvernoteAttachmentDownloadUrl(client, {
          noteId: row.noteExternalId,
          hash: row.attachment.evernoteHash!,
        });
        return fetchEvernoteAttachmentUrl(url);
      },
      persisted,
    );
    response = fetched.value;
  } else {
    const accessToken =
      typeof settings.accessToken === "string" ? settings.accessToken : "";
    const noteStoreUrl =
      typeof settings.noteStoreUrl === "string" ? settings.noteStoreUrl : "";
    if (!accessToken || !noteStoreUrl) {
      throw Object.assign(
        new Error(
          "Evernote attachment is not available for read-only download",
        ),
        { status: 404 },
      );
    }
    const bytes = await fetchEvernoteResourceData(
      accessToken,
      noteStoreUrl,
      row.attachment.externalId,
    );
    response = new Response(bytes, {
      headers: {
        "content-type": row.attachment.mime ?? "application/octet-stream",
      },
    });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw Object.assign(new Error("Evernote attachment could not be opened"), {
      status: response.status === 404 ? 404 : 502,
    });
  }
  return {
    response,
    fileName: safeName(row.attachment.fileName, "evernote-attachment"),
    mimeType:
      row.attachment.mime ??
      response.headers.get("content-type") ??
      "application/octet-stream",
  };
}

export async function getSourceRecordDocumentForUser(
  userId: string,
  sourceRecordId: string,
): Promise<OwnerDocumentResponse | null> {
  const rows = await getDb()
    .select({
      source: sourceRecords,
      connector: connectors,
    })
    .from(sourceRecords)
    .innerJoin(connectors, eq(connectors.id, sourceRecords.connectorId))
    .where(
      and(
        eq(sourceRecords.id, sourceRecordId),
        eq(sourceRecords.userId, userId),
        eq(connectors.userId, userId),
        eq(connectors.enabled, true),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.source.recordType !== "drive_file") return null;
  const fileId = row.source.externalId.replace(/^gdrive:/, "");
  if (!fileId || fileId === row.source.externalId) return null;
  const { accessToken } = await ensureGoogleAccessToken(row.connector);
  const mimeType =
    typeof row.source.recordMetadata?.mimeType === "string"
      ? row.source.recordMetadata.mimeType
      : null;
  const response = await fetchDriveFileDownload(accessToken, fileId, mimeType);
  return {
    response,
    fileName: safeName(row.source.recordTitle, "drive-file"),
    mimeType:
      response.headers.get("content-type") ??
      (mimeType?.startsWith("application/vnd.google-apps.")
        ? "application/pdf"
        : mimeType) ??
      "application/octet-stream",
  };
}

export async function getGmailAttachmentForUser(
  userId: string,
  sourceRecordId: string,
  attachmentId: string,
): Promise<OwnerDocumentResponse | null> {
  const rows = await getDb()
    .select({
      source: sourceRecords,
      connector: connectors,
    })
    .from(sourceRecords)
    .innerJoin(connectors, eq(connectors.id, sourceRecords.connectorId))
    .where(
      and(
        eq(sourceRecords.id, sourceRecordId),
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.recordType, "gmail_message"),
        eq(connectors.userId, userId),
        eq(connectors.enabled, true),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const rawAttachments = row.source.recordMetadata?.attachments;
  const attachments = Array.isArray(rawAttachments) ? rawAttachments : [];
  const attachment = attachments.find(
    (value) =>
      value &&
      typeof value === "object" &&
      (value as { id?: unknown }).id === attachmentId,
  ) as
    | {
        id: string;
        fileName?: unknown;
        mimeType?: unknown;
        sizeBytes?: unknown;
      }
    | undefined;
  if (!attachment) return null;
  const declaredSize =
    typeof attachment.sizeBytes === "number" ? attachment.sizeBytes : null;
  if (declaredSize != null && declaredSize > config.attachmentMaxBytes) {
    throw Object.assign(new Error("Gmail attachment exceeds the download cap"), {
      status: 413,
    });
  }
  const messageId = row.source.externalId.replace(/^gmail:/, "");
  if (!messageId || messageId === row.source.externalId) return null;
  const { accessToken } = await ensureGoogleAccessToken(row.connector);
  const bytes = await fetchGmailAttachmentDownload(
    accessToken,
    messageId,
    attachmentId,
  );
  if (bytes.length > config.attachmentMaxBytes) {
    throw Object.assign(new Error("Gmail attachment exceeds the download cap"), {
      status: 413,
    });
  }
  const mimeType =
    typeof attachment.mimeType === "string"
      ? attachment.mimeType
      : "application/octet-stream";
  return {
    response: new Response(bytes, {
      headers: { "content-type": mimeType },
    }),
    fileName: safeName(
      typeof attachment.fileName === "string" ? attachment.fileName : null,
      "gmail-attachment",
    ),
    mimeType,
  };
}

export async function getRecallDocumentForUser(
  userId: string,
  documentId: string,
): Promise<OwnerDocumentResponse | null> {
  const rows = await getDb()
    .select({
      fileName: documents.fileName,
      fileType: documents.fileType,
      storagePath: documents.storagePath,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  const document = rows[0];
  if (!document?.storagePath) return null;
  const absolute = path.resolve(config.attachmentsDir, document.storagePath);
  const root = `${path.resolve(config.attachmentsDir)}${path.sep}`;
  if (!absolute.startsWith(root)) return null;
  try {
    await stat(absolute);
  } catch {
    return null;
  }
  return {
    path: absolute,
    fileName: safeName(document.fileName, "document"),
    mimeType: document.fileType ?? "application/octet-stream",
  };
}
