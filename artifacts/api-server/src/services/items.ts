import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, desc, eq, sql } from "drizzle-orm";
import { captures, items, type ItemMedia } from "@workspace/db/schema";
import { config } from "../lib/config";
import { getDb } from "../lib/db";
import { createCaptureForUser, updateCaptureStatusForUser } from "./captures";
import { canonicalizeUrl, fetchLinkMetadata } from "./link-metadata";
import { evernoteDisplayTags, heuristicItemTags } from "./item-tags";
import { extractTextFromAttachmentFile } from "./attachment-text-extract";

export const ITEM_KINDS = ["note", "link", "image", "pdf", "file"] as const;
export const ITEM_SOURCES = ["recall", "evernote"] as const;
export const ITEM_LIST_BODY_MAX_CHARS = 12_000;
export const ITEM_GRAPH_BODY_MAX_CHARS = 2_000;
export const ITEM_DETAIL_BODY_MAX_CHARS = 50_000;

export type ItemSearchFilters = {
  q: string;
  type: (typeof ITEM_KINDS)[number] | null;
  tag: string | null;
  dateFrom: Date | null;
  dateTo: Date | null;
  source: (typeof ITEM_SOURCES)[number] | null;
  notebook: string | null;
  trash: boolean;
  limit: number;
  /** Maximum body preview returned per row; FTS still runs entirely in Postgres. */
  bodyTextLimit: number;
};

export type SavedItemDto = {
  id: string;
  kind: string;
  state: string;
  source: string;
  title: string;
  description: string | null;
  domain: string | null;
  sourceUrl: string | null;
  bodyText: string;
  media: ItemMedia;
  tags: string[];
  notebook: string | null;
  trashed: boolean;
  bumpedAt: string;
  createdAt: string;
  updatedAt: string;
  existing?: boolean;
};

type ProjectedRow = {
  id: unknown;
  kind: unknown;
  state: unknown;
  source: unknown;
  title: unknown;
  description: unknown;
  domain: unknown;
  source_url: unknown;
  body_text: unknown;
  media: unknown;
  tags: unknown;
  notebook: unknown;
  deleted_at: unknown;
  bumped_at: unknown;
  created_at: unknown;
  updated_at: unknown;
};

function firstString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim()),
  );
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? new Date(0).toISOString()
    : date.toISOString();
}

function toDto(row: ProjectedRow): SavedItemDto {
  return {
    id: String(row.id),
    kind: String(row.kind ?? "note"),
    state: String(row.state ?? "ready"),
    source: String(row.source ?? "recall"),
    title: String(row.title ?? "Untitled"),
    description: firstString(row.description),
    domain: firstString(row.domain),
    sourceUrl: firstString(row.source_url),
    bodyText: String(row.body_text ?? ""),
    media:
      row.media && typeof row.media === "object" && !Array.isArray(row.media)
        ? (row.media as ItemMedia)
        : {},
    tags: strings(row.tags),
    notebook: firstString(row.notebook),
    trashed: Boolean(row.deleted_at),
    bumpedAt: iso(row.bumped_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowsFrom(result: unknown): ProjectedRow[] {
  const possible = result as { rows?: ProjectedRow[] };
  return (
    possible.rows ?? (Array.isArray(result) ? (result as ProjectedRow[]) : [])
  );
}

function parseDate(value: unknown, endOfDay = false): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const date = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseItemSearchFilters(
  query: Record<string, unknown>,
): ItemSearchFilters {
  const type =
    typeof query.type === "string" &&
    (ITEM_KINDS as readonly string[]).includes(query.type.toLowerCase())
      ? (query.type.toLowerCase() as ItemSearchFilters["type"])
      : null;
  const source =
    typeof query.source === "string" &&
    (ITEM_SOURCES as readonly string[]).includes(query.source.toLowerCase())
      ? (query.source.toLowerCase() as ItemSearchFilters["source"])
      : null;
  const rawLimit = Number(query.limit);
  return {
    q: typeof query.q === "string" ? query.q.trim().slice(0, 300) : "",
    type,
    tag:
      typeof query.tag === "string"
        ? query.tag.trim().slice(0, 100) || null
        : null,
    dateFrom: parseDate(query.dateFrom),
    dateTo: parseDate(query.dateTo, true),
    source,
    notebook:
      typeof query.notebook === "string"
        ? query.notebook.trim().slice(0, 500) || null
        : null,
    trash: query.trash === "true" || query.trash === true,
    limit: Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
      : 100,
    bodyTextLimit: ITEM_LIST_BODY_MAX_CHARS,
  };
}

function commonNativeConditions(userId: string, filters: ItemSearchFilters) {
  const clauses = [sql`i.user_id = ${userId}::uuid`];
  clauses.push(
    filters.trash ? sql`i.deleted_at IS NOT NULL` : sql`i.deleted_at IS NULL`,
  );
  if (filters.q) {
    clauses.push(
      sql`i.search_tsv @@ websearch_to_tsquery('simple', ${filters.q})`,
    );
  }
  if (filters.type) clauses.push(sql`i.kind = ${filters.type}`);
  if (filters.source) clauses.push(sql`i.source = ${filters.source}`);
  if (filters.notebook)
    clauses.push(sql`lower(i.notebook) = lower(${filters.notebook})`);
  if (filters.tag) {
    clauses.push(
      sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(i.tags) tag(value)
        WHERE lower(tag.value) = lower(${filters.tag})
      )`,
    );
  }
  if (filters.dateFrom) clauses.push(sql`i.created_at >= ${filters.dateFrom}`);
  if (filters.dateTo) clauses.push(sql`i.created_at <= ${filters.dateTo}`);
  return clauses;
}

async function listNativeItems(
  userId: string,
  filters: ItemSearchFilters,
): Promise<SavedItemDto[]> {
  if (filters.source === "evernote") return [];
  const where = sql.join(commonNativeConditions(userId, filters), sql` AND `);
  const result = await getDb().execute(sql`
    SELECT
      i.id, i.kind, i.state, i.source, i.title, i.description, i.domain,
      i.source_url, left(i.body_text, ${filters.bodyTextLimit}) AS body_text,
      i.media, i.tags, i.notebook, i.deleted_at,
      i.bumped_at, i.created_at, i.updated_at
    FROM items i
    WHERE ${where}
    ORDER BY i.bumped_at DESC
    LIMIT ${filters.limit}
  `);
  return rowsFrom(result).map(toDto);
}

async function listNoteItems(
  userId: string,
  filters: ItemSearchFilters,
): Promise<SavedItemDto[]> {
  if (filters.trash || filters.source === "evernote") return [];
  if (filters.type && filters.type !== "note") return [];
  const clauses = [sql`n.user_id = ${userId}::uuid`];
  if (filters.q)
    clauses.push(
      sql`n.search_tsv @@ websearch_to_tsquery('simple', ${filters.q})`,
    );
  if (filters.notebook)
    clauses.push(sql`lower(nb.name) = lower(${filters.notebook})`);
  if (filters.tag) {
    clauses.push(
      sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(n.tags) tag(value)
        WHERE lower(tag.value) = lower(${filters.tag})
      )`,
    );
  }
  if (filters.dateFrom) clauses.push(sql`n.created_at >= ${filters.dateFrom}`);
  if (filters.dateTo) clauses.push(sql`n.created_at <= ${filters.dateTo}`);

  const result = await getDb().execute(sql`
    SELECT
      concat('note:', n.id) AS id,
      'note' AS kind,
      'ready' AS state,
      'recall' AS source,
      n.title,
      null::text AS description,
      null::text AS domain,
      null::text AS source_url,
      left(n.preview, 280) AS body_text,
      '{}'::jsonb AS media,
      n.tags,
      nb.name AS notebook,
      null::timestamptz AS deleted_at,
      n.updated_at AS bumped_at,
      n.created_at,
      n.updated_at
    FROM notes n
    LEFT JOIN notebooks nb ON nb.id = n.notebook_id
    WHERE ${sql.join(clauses, sql` AND `)}
    ORDER BY n.updated_at DESC
    LIMIT ${filters.limit}
  `);
  return rowsFrom(result).map(toDto);
}

async function listEvernoteItems(
  userId: string,
  filters: ItemSearchFilters,
): Promise<SavedItemDto[]> {
  if (filters.source === "recall") return [];
  if (filters.type && filters.type !== "note") return [];

  const clauses = [
    sql`sr.user_id = ${userId}::uuid`,
    sql`(c.type = 'evernote' OR sr.record_type = 'evernote_note')`,
  ];
  const trashed = sql`lower(coalesce(
    sr.record_metadata->>'trashed',
    sr.record_metadata->>'deleted',
    'false'
  )) IN ('true', '1', 'yes')`;
  clauses.push(
    filters.trash ? sql`${trashed} = true` : sql`${trashed} = false`,
  );
  if (filters.q) {
    clauses.push(sql`to_tsvector(
      'simple',
      concat_ws(
        E'\n',
        sr.record_title,
        sr.record_text,
        sr.record_metadata->>'notebookName',
        sr.record_metadata->>'tagNames'
      )
    ) @@ websearch_to_tsquery('simple', ${filters.q})`);
  }
  if (filters.notebook) {
    clauses.push(
      sql`lower(sr.record_metadata->>'notebookName') = lower(${filters.notebook})`,
    );
  }
  if (filters.tag) {
    clauses.push(sql`EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(sr.record_metadata->'tagNames') = 'array'
            THEN sr.record_metadata->'tagNames'
          WHEN jsonb_typeof(sr.record_metadata->'tags') = 'array'
            THEN sr.record_metadata->'tags'
          ELSE '[]'::jsonb
        END
      ) tag(value)
      WHERE lower(tag.value) = lower(${filters.tag})
    )`);
  }
  if (filters.dateFrom) {
    clauses.push(
      sql`coalesce(sr.source_created_at, sr.created_at) >= ${filters.dateFrom}`,
    );
  }
  if (filters.dateTo) {
    clauses.push(
      sql`coalesce(sr.source_created_at, sr.created_at) <= ${filters.dateTo}`,
    );
  }

  const result = await getDb().execute(sql`
    SELECT
      concat('evernote:', sr.id) AS id,
      'note' AS kind,
      'ready' AS state,
      'evernote' AS source,
      coalesce(sr.record_title, 'Untitled') AS title,
      null::text AS description,
      null::text AS domain,
      sr.source_url,
      left(coalesce(sr.record_text, ''), ${filters.bodyTextLimit}) AS body_text,
      '{}'::jsonb AS media,
      CASE
        WHEN jsonb_typeof(sr.record_metadata->'tagNames') = 'array'
          THEN sr.record_metadata->'tagNames'
        WHEN jsonb_typeof(sr.record_metadata->'tags') = 'array'
          THEN sr.record_metadata->'tags'
        ELSE '[]'::jsonb
      END AS tags,
      sr.record_metadata->>'notebookName' AS notebook,
      CASE WHEN ${trashed} THEN coalesce(sr.updated_at, now()) ELSE null END AS deleted_at,
      coalesce(sr.source_updated_at, sr.updated_at) AS bumped_at,
      coalesce(sr.source_created_at, sr.created_at) AS created_at,
      coalesce(sr.source_updated_at, sr.updated_at) AS updated_at
    FROM source_records sr
    JOIN connectors c ON c.id = sr.connector_id
    WHERE ${sql.join(clauses, sql` AND `)}
    ORDER BY coalesce(sr.source_updated_at, sr.updated_at) DESC
    LIMIT ${filters.limit}
  `);
  return rowsFrom(result).map((row) => {
    const dto = toDto(row);
    dto.tags = evernoteDisplayTags(dto.tags);
    return dto;
  });
}

export async function listItemsForUser(
  userId: string,
  filters: ItemSearchFilters,
): Promise<SavedItemDto[]> {
  const [native, notes, evernote] = await Promise.all([
    listNativeItems(userId, filters),
    listNoteItems(userId, filters),
    listEvernoteItems(userId, filters),
  ]);
  return [...native, ...notes, ...evernote]
    .sort((a, b) => Date.parse(b.bumpedAt) - Date.parse(a.bumpedAt))
    .slice(0, filters.limit);
}

async function getProjectedItem(
  userId: string,
  id: string,
): Promise<SavedItemDto | null> {
  const rawId = id.slice(id.indexOf(":") + 1);
  if (id.startsWith("source-record:")) {
    const result = await getDb().execute(sql`
      SELECT
        concat('source-record:', sr.id) AS id,
        sr.record_type AS kind,
        'ready' AS state,
        CASE sr.record_type
          WHEN 'evernote_note' THEN 'evernote'
          WHEN 'gmail_message' THEN 'gmail'
          WHEN 'drive_file' THEN 'drive'
          WHEN 'calendar_event' THEN 'calendar'
          WHEN 'finance_transaction' THEN 'finance'
          WHEN 'flipperforce_project' THEN 'flipperforce'
          WHEN 'homey_device' THEN 'homey'
          WHEN 'homey_flow' THEN 'homey'
          WHEN 'homey_alert' THEN 'homey'
          WHEN 'google_contact' THEN 'contact'
          ELSE 'connector'
        END AS source,
        coalesce(sr.record_title, 'Untitled') AS title,
        null::text AS description,
        null::text AS domain,
        sr.source_url,
        left(coalesce(sr.record_text, ''), ${ITEM_DETAIL_BODY_MAX_CHARS}) AS body_text,
        '{}'::jsonb AS media,
        CASE
          WHEN sr.record_type = 'evernote_note'
            AND jsonb_typeof(sr.record_metadata->'tagNames') = 'array'
            THEN sr.record_metadata->'tagNames'
          WHEN sr.record_type = 'evernote_note'
            AND jsonb_typeof(sr.record_metadata->'tags') = 'array'
            THEN sr.record_metadata->'tags'
          ELSE '[]'::jsonb
        END AS tags,
        CASE
          WHEN sr.record_type = 'evernote_note'
            THEN sr.record_metadata->>'notebookName'
          ELSE null
        END AS notebook,
        null::timestamptz AS deleted_at,
        coalesce(sr.source_updated_at, sr.updated_at) AS bumped_at,
        coalesce(sr.source_created_at, sr.created_at) AS created_at,
        coalesce(sr.source_updated_at, sr.updated_at) AS updated_at
      FROM source_records sr
      JOIN connectors c ON c.id = sr.connector_id AND c.enabled = true
      WHERE sr.user_id = ${userId}::uuid AND sr.id = ${rawId}
      LIMIT 1
    `);
    const row = rowsFrom(result)[0];
    if (!row) return null;
    const dto = toDto(row);
    if (dto.source === "evernote") dto.tags = evernoteDisplayTags(dto.tags);
    return dto;
  }
  if (id.startsWith("memory:")) {
    const result = await getDb().execute(sql`
      SELECT
        concat('memory:', m.id) AS id,
        'memory' AS kind,
        'ready' AS state,
        'memory' AS source,
        m.title,
        m.summary AS description,
        null::text AS domain,
        null::text AS source_url,
        left(m.content, ${ITEM_DETAIL_BODY_MAX_CHARS}) AS body_text,
        '{}'::jsonb AS media,
        m.tags,
        null::text AS notebook,
        null::timestamptz AS deleted_at,
        m.updated_at AS bumped_at,
        m.created_at,
        m.updated_at
      FROM life_memories m
      WHERE m.user_id = ${userId}::uuid AND m.id = ${rawId}
      LIMIT 1
    `);
    const row = rowsFrom(result)[0];
    return row ? toDto(row) : null;
  }
  if (id.startsWith("task:")) {
    const result = await getDb().execute(sql`
      SELECT
        concat('task:', t.id) AS id,
        'task' AS kind,
        'ready' AS state,
        'task' AS source,
        t.title,
        concat_ws(' · ', nullif(t.priority, 'none'), t.time) AS description,
        null::text AS domain,
        null::text AS source_url,
        ''::text AS body_text,
        '{}'::jsonb AS media,
        t.tags,
        null::text AS notebook,
        null::timestamptz AS deleted_at,
        t.updated_at AS bumped_at,
        t.created_at,
        t.updated_at
      FROM tasks t
      WHERE t.user_id = ${userId}::uuid AND t.id = ${rawId}
      LIMIT 1
    `);
    const row = rowsFrom(result)[0];
    return row ? toDto(row) : null;
  }
  if (id.startsWith("note:")) {
    const result = await getDb().execute(sql`
      SELECT
        concat('note:', n.id) AS id,
        'note' AS kind,
        'ready' AS state,
        'recall' AS source,
        n.title,
        null::text AS description,
        null::text AS domain,
        null::text AS source_url,
        left(n.preview, 280) AS body_text,
        '{}'::jsonb AS media,
        n.tags,
        nb.name AS notebook,
        null::timestamptz AS deleted_at,
        n.updated_at AS bumped_at,
        n.created_at,
        n.updated_at
      FROM notes n
      LEFT JOIN notebooks nb ON nb.id = n.notebook_id
      WHERE n.user_id = ${userId}::uuid AND n.id = ${rawId}
      LIMIT 1
    `);
    const row = rowsFrom(result)[0];
    return row ? toDto(row) : null;
  }

  const result = await getDb().execute(sql`
    SELECT
      concat('evernote:', sr.id) AS id,
      'note' AS kind,
      'ready' AS state,
      'evernote' AS source,
      coalesce(sr.record_title, 'Untitled') AS title,
      null::text AS description,
      null::text AS domain,
      sr.source_url,
      left(coalesce(sr.record_text, ''), ${ITEM_DETAIL_BODY_MAX_CHARS}) AS body_text,
      '{}'::jsonb AS media,
      CASE
        WHEN jsonb_typeof(sr.record_metadata->'tagNames') = 'array'
          THEN sr.record_metadata->'tagNames'
        WHEN jsonb_typeof(sr.record_metadata->'tags') = 'array'
          THEN sr.record_metadata->'tags'
        ELSE '[]'::jsonb
      END AS tags,
      sr.record_metadata->>'notebookName' AS notebook,
      CASE
        WHEN lower(coalesce(
          sr.record_metadata->>'trashed',
          sr.record_metadata->>'deleted',
          'false'
        )) IN ('true', '1', 'yes')
          THEN coalesce(sr.updated_at, now())
        ELSE null
      END AS deleted_at,
      coalesce(sr.source_updated_at, sr.updated_at) AS bumped_at,
      coalesce(sr.source_created_at, sr.created_at) AS created_at,
      coalesce(sr.source_updated_at, sr.updated_at) AS updated_at
    FROM source_records sr
    JOIN connectors c ON c.id = sr.connector_id
    WHERE sr.user_id = ${userId}::uuid
      AND sr.id = ${rawId}
      AND (c.type = 'evernote' OR sr.record_type = 'evernote_note')
    LIMIT 1
  `);
  const row = rowsFrom(result)[0];
  if (!row) return null;
  const dto = toDto(row);
  dto.tags = evernoteDisplayTags(dto.tags);
  return dto;
}

export async function getItemForUser(
  userId: string,
  id: string,
): Promise<SavedItemDto | null> {
  if (
    id.startsWith("note:") ||
    id.startsWith("evernote:") ||
    id.startsWith("source-record:") ||
    id.startsWith("memory:") ||
    id.startsWith("task:")
  ) {
    return getProjectedItem(userId, id);
  }
  const rows = await getDb()
    .select({
      id: items.id,
      kind: items.kind,
      state: items.state,
      source: items.source,
      title: items.title,
      description: items.description,
      domain: items.domain,
      sourceUrl: items.sourceUrl,
      bodyText: sql<string>`left(${items.bodyText}, ${ITEM_DETAIL_BODY_MAX_CHARS})`,
      media: items.media,
      tags: items.tags,
      notebook: items.notebook,
      deletedAt: items.deletedAt,
      bumpedAt: items.bumpedAt,
      createdAt: items.createdAt,
      updatedAt: items.updatedAt,
    })
    .from(items)
    .where(and(eq(items.userId, userId), eq(items.id, id)))
    .limit(1);
  if (!rows[0]) return null;
  return toDto({
    id: rows[0].id,
    kind: rows[0].kind,
    state: rows[0].state,
    source: rows[0].source,
    title: rows[0].title,
    description: rows[0].description,
    domain: rows[0].domain,
    source_url: rows[0].sourceUrl,
    body_text: rows[0].bodyText,
    media: rows[0].media,
    tags: rows[0].tags,
    notebook: rows[0].notebook,
    deleted_at: rows[0].deletedAt,
    bumped_at: rows[0].bumpedAt,
    created_at: rows[0].createdAt,
    updated_at: rows[0].updatedAt,
  });
}

function itemId(): string {
  return `item-${randomUUID()}`;
}

async function finishRawCapture(
  userId: string,
  captureId: string,
): Promise<void> {
  await updateCaptureStatusForUser(userId, captureId, {
    processedStatus: "ignored",
  });
}

export async function saveTextItemForUser(
  userId: string,
  value: string,
): Promise<SavedItemDto> {
  const text = value.trim();
  if (!text)
    throw Object.assign(new Error("Enter a note or link to save"), {
      status: 400,
    });
  if (text.length > 1_000_000) {
    throw Object.assign(new Error("Saved text is too large"), { status: 413 });
  }

  let canonicalUrl: string | null = null;
  try {
    canonicalUrl = canonicalizeUrl(text);
  } catch {
    canonicalUrl = null;
  }

  const capture = await createCaptureForUser(userId, {
    rawText: text,
    sourceType: canonicalUrl ? "item_link" : "item_note",
    sourceUrl: canonicalUrl,
    title: canonicalUrl ? null : text.split(/\r?\n/, 1)[0],
  });
  const now = new Date();

  if (canonicalUrl) {
    const urlHash = createHash("sha256").update(canonicalUrl).digest("hex");
    const existing = await getDb()
      .select()
      .from(items)
      .where(and(eq(items.userId, userId), eq(items.urlHash, urlHash)))
      .limit(1);
    if (existing[0]) {
      const [bumped] = await getDb()
        .update(items)
        .set({ bumpedAt: now, updatedAt: now })
        .where(eq(items.id, existing[0].id))
        .returning();
      await finishRawCapture(userId, capture.id);
      return { ...(await getItemForUser(userId, bumped!.id))!, existing: true };
    }

    const url = new URL(canonicalUrl);
    let metadata: Awaited<ReturnType<typeof fetchLinkMetadata>> | null = null;
    try {
      metadata = await fetchLinkMetadata(canonicalUrl);
    } catch {
      // Saving remains reliable when a public page times out or rejects bots.
    }
    const domain = metadata?.domain ?? url.hostname.replace(/^www\./, "");
    const id = itemId();
    await getDb()
      .insert(items)
      .values({
        id,
        userId,
        captureId: capture.id,
        kind: "link",
        state: "ready",
        source: "recall",
        title: metadata?.title ?? domain,
        description: metadata?.description ?? null,
        domain,
        sourceUrl: canonicalUrl,
        canonicalUrl: metadata?.canonicalUrl ?? canonicalUrl,
        urlHash,
        bodyText: "",
        media: metadata?.imageUrl ? { remoteUrl: metadata.imageUrl } : {},
        tags: heuristicItemTags({ url: canonicalUrl, date: now }),
        bumpedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    await finishRawCapture(userId, capture.id);
    return (await getItemForUser(userId, id))!;
  }

  const id = itemId();
  const title = text.split(/\r?\n/, 1)[0]!.slice(0, 500) || "Untitled note";
  await getDb()
    .insert(items)
    .values({
      id,
      userId,
      captureId: capture.id,
      kind: "note",
      state: "ready",
      source: "recall",
      title,
      bodyText: text,
      tags: heuristicItemTags({ date: now }),
      bumpedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  await finishRawCapture(userId, capture.id);
  return (await getItemForUser(userId, id))!;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "image";
}

function imageKind(mimeType: string): "image" | "pdf" | "file" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return "file";
}

export async function saveFileItemForUser(
  userId: string,
  file: {
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  },
  caption = "",
): Promise<SavedItemDto> {
  if (!file.buffer.length)
    throw Object.assign(new Error("File is empty"), { status: 400 });
  if (file.size > config.attachmentMaxBytes) {
    throw Object.assign(new Error("File exceeds the upload size cap"), {
      status: 413,
    });
  }

  const fileName = safeFileName(file.originalname);
  const cleanCaption = caption.trim().slice(0, 20_000);
  const capture = await createCaptureForUser(userId, {
    rawText: `${cleanCaption ? `${cleanCaption}\n` : ""}[file] ${fileName}`,
    sourceType: file.mimetype.startsWith("image/") ? "item_image" : "item_file",
    title: fileName,
    rawMetadata: { fileName, mimeType: file.mimetype, sizeBytes: file.size },
  });
  const id = itemId();
  const relativeDir = path.join(userId, "items", id);
  const absoluteDir = path.join(config.attachmentsDir, relativeDir);
  await mkdir(absoluteDir, { recursive: true });
  const storagePath = path.join(relativeDir, fileName);
  const absolutePath = path.join(config.attachmentsDir, storagePath);
  try {
    await pipeline(Readable.from(file.buffer), createWriteStream(absolutePath));
    const extractedText = file.mimetype.startsWith("image/")
      ? ""
      : await extractTextFromAttachmentFile({
          absPath: absolutePath,
          mimeType: file.mimetype,
          fileName,
          sizeBytes: file.size,
        });

    const now = new Date();
    await getDb()
      .insert(items)
      .values({
        id,
        userId,
        captureId: capture.id,
        kind: imageKind(file.mimetype),
        state: "ready",
        source: "recall",
        title: fileName.replace(/\.[^.]+$/, "") || fileName,
        description: cleanCaption || null,
        bodyText: [cleanCaption, extractedText].filter(Boolean).join("\n\n"),
        media: {
          storagePath,
          fileName,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        },
        tags: heuristicItemTags({ mimeType: file.mimetype, date: now }),
        bumpedAt: now,
        createdAt: now,
        updatedAt: now,
      });
  } catch (error) {
    await rm(absoluteDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
  await finishRawCapture(userId, capture.id);
  return (await getItemForUser(userId, id))!;
}

export async function deleteItemForUser(
  userId: string,
  id: string,
): Promise<boolean> {
  if (id.startsWith("note:") || id.startsWith("evernote:")) return false;
  const item = await getItemForUser(userId, id);
  if (!item) return false;
  const storagePath = item.media.storagePath;
  if (storagePath) {
    const absolute = path.resolve(config.attachmentsDir, storagePath);
    const root = `${path.resolve(config.attachmentsDir)}${path.sep}`;
    if (!absolute.startsWith(root)) {
      throw Object.assign(new Error("Item media path is invalid"), {
        status: 409,
      });
    }
    await rm(path.dirname(absolute), { recursive: true, force: true });
  }
  const deleted = await getDb()
    .delete(items)
    .where(and(eq(items.id, id), eq(items.userId, userId)))
    .returning({ captureId: items.captureId });
  const captureId = deleted[0]?.captureId;
  if (captureId) {
    await getDb()
      .delete(captures)
      .where(and(eq(captures.id, captureId), eq(captures.userId, userId)));
  }
  return deleted.length > 0;
}

export async function getItemMediaForUser(
  userId: string,
  id: string,
): Promise<{ path: string; mimeType: string; fileName: string } | null> {
  const item = await getItemForUser(userId, id);
  const storagePath = item?.media.storagePath;
  if (!item || !storagePath) return null;
  const absolute = path.resolve(config.attachmentsDir, storagePath);
  const root = `${path.resolve(config.attachmentsDir)}${path.sep}`;
  if (!absolute.startsWith(root)) return null;
  try {
    await stat(absolute);
  } catch {
    return null;
  }
  return {
    path: absolute,
    mimeType: item.media.mimeType ?? "application/octet-stream",
    fileName: item.media.fileName ?? "item",
  };
}

export async function listItemFacetsForUser(userId: string): Promise<{
  tags: string[];
  notebooks: string[];
}> {
  const recent = await listItemsForUser(
    userId,
    parseItemSearchFilters({ limit: 200 }),
  );
  return {
    tags: [...new Set(recent.flatMap((item) => item.tags))]
      .sort()
      .slice(0, 100),
    notebooks: [
      ...new Set(
        recent.map((item) => item.notebook).filter(Boolean) as string[],
      ),
    ]
      .sort()
      .slice(0, 100),
  };
}
