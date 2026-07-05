import type { CreateNoteInput } from "./notes";
import { previewFromContent } from "../lib/recall-format";
import {
  writeAttachmentFile,
  type NoteAttachmentDto,
  type PendingNoteAttachment,
} from "./note-attachments";

export interface EnexParseResult {
  notes: CreateNoteInput[];
  errors: string[];
}

export type EnexParseContext = {
  userId: string;
};

function stripPrologue(xml: string): string {
  return xml
    .replace(/^\uFEFF/, "")
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .trim();
}

function hashNoteKey(title: string, created: string, index: number): string {
  const raw = `${title}\0${created}\0${index}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function decodeXmlEntities(text: string): string {
  const withNumeric = text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)));

  return withNumeric
    .replace(/&nbsp;/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractDecodedTag(block: string, tag: string): string | undefined {
  const raw = extractTag(block, tag);
  return raw === undefined ? undefined : decodeXmlEntities(raw);
}

function extractTag(block: string, tag: string): string | undefined {
  const cdataRe = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`,
    "i",
  );
  const cdata = block.match(cdataRe);
  if (cdata?.[1] !== undefined) return cdata[1].trim();

  const plainRe = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const plain = block.match(plainRe);
  if (!plain?.[1]) return undefined;
  return plain[1].trim();
}

function extractTags(block: string): string[] {
  const tags: string[] = [];
  const re = /<tag[^>]*>([^<]*)<\/tag>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const t = m[1]?.trim();
    if (t) tags.push(decodeXmlEntities(t));
  }
  return tags;
}

function extractResourceFileName(resourceBody: string): string {
  const attrs = resourceBody.match(/<resource-attributes>[\s\S]*?<\/resource-attributes>/i)?.[0];
  const scope = attrs ?? resourceBody;
  return (
    decodeXmlEntities(
      extractTag(scope, "file-name") ||
        extractTag(scope, "filename") ||
        extractTag(resourceBody, "filename") ||
        "attachment",
    )
  );
}

function extractBase64Data(resourceBody: string): string | null {
  const m = resourceBody.match(/<data[^>]*encoding="base64"[^>]*>([\s\S]*?)<\/data>/i);
  return m?.[1]?.replace(/\s/g, "") ?? null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function enmlToHtml(
  enml: string,
  hashToAttachmentId: Map<string, string>,
  savedAttachments: NoteAttachmentDto[],
): string {
  if (!enml.trim()) return "";

  let html = enml
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "");

  const enNoteMatch = html.match(/<en-note[^>]*>([\s\S]*?)<\/en-note>/i);
  if (enNoteMatch) html = enNoteMatch[1]!;

  html = html.replace(/<en-crypt[^>]*>[\s\S]*?<\/en-crypt>/gi, "");
  html = html.replace(/<en-todo[^>]*checked="true"[^>]*\/?>/gi, "☑ ");
  html = html.replace(/<en-todo[^>]*\/?>/gi, "☐ ");

  html = html.replace(/<en-media\b([^>]*)\/?>/gi, (_match, attrs: string) => {
    const hashMatch = attrs.match(/\bhash="([^"]+)"/i);
    const typeMatch = attrs.match(/\btype="([^"]+)"/i);
    const hash = hashMatch?.[1]?.toLowerCase() ?? "";
    const type = typeMatch?.[1] ?? "application/octet-stream";
    const attId = hash ? hashToAttachmentId.get(hash) : undefined;
    if (!attId) return "";
    if (type.startsWith("image/")) {
      return `<img data-recall-attachment="${attId}" alt="" class="recall-note-image" />`;
    }
    return `<a data-recall-attachment="${attId}" class="recall-attachment-link">${escapeHtml(type)}</a>`;
  });

  html = html.replace(/<br\s*\/?>/gi, "<br />");

  const unusedFiles = savedAttachments.filter(
    (f) => !html.includes(`data-recall-attachment="${f.id}"`),
  );
  if (unusedFiles.length > 0) {
    const links = unusedFiles
      .map(
        (f) =>
          `<li><a data-recall-attachment="${f.id}" class="recall-attachment-link">${escapeHtml(f.fileName)}</a> <span class="recall-attachment-mime">(${escapeHtml(f.mimeType)})</span></li>`,
      )
      .join("");
    html += `\n<div class="recall-attachments"><h4>Attachments</h4><ul>${links}</ul></div>`;
  }

  return html.trim();
}

function enmlToPlainText(enml: string): string {
  if (!enml.trim()) return "";

  let html = enml
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "");

  const enNoteMatch = html.match(/<en-note[^>]*>([\s\S]*?)<\/en-note>/i);
  if (enNoteMatch) html = enNoteMatch[1]!;

  html = html.replace(/<br\s*\/?>/gi, "\n");
  html = html.replace(/<\/div>/gi, "\n");
  html = html.replace(/<\/p>/gi, "\n");
  html = html.replace(/<li[^>]*>/gi, "• ");
  html = html.replace(/<en-media[^>]*\/?>/gi, "");
  html = html.replace(/<[^>]+>/g, "");

  return decodeXmlEntities(html)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractResources(
  block: string,
  userId: string,
  noteId: string,
): Promise<{ hashToId: Map<string, string>; saved: NoteAttachmentDto[]; pending: PendingNoteAttachment[] }> {
  const hashToId = new Map<string, string>();
  const saved: NoteAttachmentDto[] = [];
  const pending: PendingNoteAttachment[] = [];
  const resourceRe = /<resource>([\s\S]*?)<\/resource>/gi;
  let match: RegExpExecArray | null;

  while ((match = resourceRe.exec(block)) !== null) {
    const rb = match[1]!;
    const resourceHash = (extractTag(rb, "resource-hash") || "").toLowerCase();
    const mimeType = extractTag(rb, "mime") || "application/octet-stream";
    const fileName = extractResourceFileName(rb);
    const b64 = extractBase64Data(rb);
    if (!b64) continue;

    let data: Buffer;
    try {
      data = Buffer.from(b64, "base64");
    } catch {
      continue;
    }

    const att = await writeAttachmentFile({
      userId,
      noteId,
      resourceHash,
      fileName,
      mimeType,
      data,
    });

    if (att) {
      pending.push(att);
      saved.push({
        id: att.id,
        noteId: att.noteId,
        fileName: att.fileName,
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes,
        isImage: att.mimeType.startsWith("image/"),
      });
      if (resourceHash) hashToId.set(resourceHash, att.id);
    }
  }

  return { hashToId, saved, pending };
}

async function parseNoteBlock(
  block: string,
  index: number,
  ctx: EnexParseContext,
): Promise<CreateNoteInput> {
  const title = extractDecodedTag(block, "title") || "Untitled";
  const guid = extractTag(block, "guid");
  const created = extractTag(block, "created") ?? "";
  const updated = extractTag(block, "updated") ?? "";
  const rawContent = extractTag(block, "content") ?? "";
  const tags = extractTags(block);
  const stableKey = hashNoteKey(title, created || updated, index);
  const id = guid ? `note-en-${guid}` : `note-en-${stableKey}`;

  const { hashToId, saved, pending } = await extractResources(block, ctx.userId, id);

  let content: string;
  let contentFormat: "plain" | "html" = "plain";

  const hasRichContent =
    saved.length > 0 || /<en-media/i.test(rawContent) || /<en-note/i.test(rawContent);

  if (hasRichContent) {
    content = enmlToHtml(rawContent, hashToId, saved);
    contentFormat =
      content.includes("data-recall-attachment") || /<[a-z][\s\S]*>/i.test(content)
        ? "html"
        : "plain";
  } else {
    content = enmlToPlainText(rawContent);
  }

  if (!content.trim() && saved.length > 0) {
    content = enmlToHtml(rawContent, hashToId, saved);
    contentFormat = "html";
  }

  return {
    id,
    title,
    content,
    contentFormat,
    tags,
    pinned: false,
    pendingAttachments: pending,
  };
}

export function parseEnexXml(_xml: string, sourceName?: string): EnexParseResult {
  return {
    notes: [],
    errors: [
      sourceName
        ? `${sourceName}: use server ENEX upload for attachments`
        : "Use server ENEX upload for attachments",
    ],
  };
}

const NOTE_OPEN_RE = /<note[\s>]/i;
const NOTE_CLOSE = "</note>";
const MAX_NOTE_BUFFER_BYTES = 80 * 1024 * 1024;
const BUFFER_TRIM_BYTES = 256 * 1024;

function stripStreamingNoise(buffer: string): string {
  return buffer.replace(/<recognition>[\s\S]*?<\/recognition>/gi, "");
}

export async function parseEnexFileStream(
  filePath: string,
  sourceName: string | undefined,
  ctx: EnexParseContext,
  onBatch: (notes: CreateNoteInput[]) => Promise<void>,
  batchSize = 5,
): Promise<{ parsed: number; errors: string[] }> {
  const { createReadStream } = await import("node:fs");
  const errors: string[] = [];
  let parsed = 0;
  let noteIndex = 0;
  let buffer = "";
  let batch: CreateNoteInput[] = [];
  let sawNote = false;

  const flushBatch = async () => {
    if (batch.length === 0) return;
    await onBatch(batch);
    batch = [];
  };

  const stream = createReadStream(filePath, {
    encoding: "utf8",
    highWaterMark: 256 * 1024,
  });

  for await (const chunk of stream) {
    buffer += chunk;
    if (buffer.length > 4 * 1024 * 1024) {
      buffer = stripStreamingNoise(buffer);
    }

    while (true) {
      const start = buffer.search(NOTE_OPEN_RE);
      if (start === -1) {
        if (buffer.length > BUFFER_TRIM_BYTES) {
          buffer = buffer.slice(-BUFFER_TRIM_BYTES);
        }
        break;
      }

      const end = buffer.indexOf(NOTE_CLOSE, start);
      if (end === -1) {
        const partialSize = buffer.length - start;
        if (partialSize > MAX_NOTE_BUFFER_BYTES) {
          errors.push(
            sourceName
              ? `${sourceName}: skipped note ${noteIndex + 1} — exceeds ${MAX_NOTE_BUFFER_BYTES / (1024 * 1024)}MB`
              : `Skipped note ${noteIndex + 1} — exceeds size limit`,
          );
          const nextStart = buffer.indexOf("<note", start + 1);
          buffer = nextStart === -1 ? "" : buffer.slice(nextStart);
          noteIndex++;
          continue;
        }
        break;
      }

      const fullBlock = buffer.slice(start, end + NOTE_CLOSE.length);
      buffer = buffer.slice(end + NOTE_CLOSE.length);
      sawNote = true;

      try {
        const note = await parseNoteBlock(fullBlock, noteIndex++, ctx);
        batch.push(note);
        parsed++;
        if (batch.length >= batchSize) {
          await flushBatch();
        }
      } catch (err) {
        errors.push(
          sourceName
            ? `${sourceName}: could not read note ${noteIndex} (${err instanceof Error ? err.message : "error"})`
            : `Could not read note ${noteIndex}`,
        );
      }
    }
  }

  await flushBatch();

  if (parsed === 0) {
    errors.push(
      sawNote
        ? sourceName
          ? `${sourceName}: found note blocks but could not parse them`
          : "Found note blocks but could not parse them"
        : sourceName
          ? `${sourceName}: no notes found — export as Evernote .enex`
          : "No notes found — use Evernote .enex export format",
    );
  }

  return { parsed, errors };
}

export function notePreview(content: string, contentFormat?: string): string {
  if (contentFormat === "html") {
    const text = content
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return previewFromContent(text);
  }
  return previewFromContent(content);
}
