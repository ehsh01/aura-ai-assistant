import type { RecallNote } from "./recall-context";
import { noteDateLabel, previewFromContent } from "./recall-storage";

export interface EvernoteImportResult {
  notes: Partial<RecallNote>[];
  errors: string[];
}

function stripExportPrologue(xml: string): string {
  return xml
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

function childText(noteEl: Element, tag: string): string | undefined {
  const nodes = noteEl.getElementsByTagName(tag);
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (el.parentElement === noteEl) {
      return el.textContent?.trim() || undefined;
    }
  }
  return undefined;
}

function childTags(noteEl: Element): string[] {
  const tags: string[] = [];
  const nodes = noteEl.getElementsByTagName("tag");
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (el.parentElement === noteEl) {
      const t = el.textContent?.trim();
      if (t) tags.push(t);
    }
  }
  return tags;
}

function evernoteDateLabel(raw?: string | null): string {
  if (!raw?.trim()) return noteDateLabel();
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return noteDateLabel();
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return noteDateLabel();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function enmlToPlainText(enml: string): string {
  const cleaned = stripExportPrologue(enml);
  if (!cleaned) return "";

  const parser = new DOMParser();
  const doc = parser.parseFromString(cleaned, "text/xml");
  const enNote = doc.getElementsByTagName("en-note")[0];
  const html = enNote?.innerHTML ?? cleaned;

  const div = document.createElement("div");
  div.innerHTML = html;

  div.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  div.querySelectorAll("li").forEach((li) => {
    if (!li.textContent?.trim().startsWith("•")) {
      li.prepend("• ");
    }
  });

  return (div.innerText || div.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attachmentLines(noteEl: Element): string[] {
  const lines: string[] = [];
  const resources = noteEl.getElementsByTagName("resource");
  for (let i = 0; i < resources.length; i++) {
    const resource = resources[i];
    if (resource.parentElement !== noteEl) continue;
    const attrs = resource.getElementsByTagName("resource-attributes")[0];
    const fileName =
      attrs?.getElementsByTagName("filename")[0]?.textContent?.trim() ||
      resource.getElementsByTagName("filename")[0]?.textContent?.trim();
    const mime = resource.getElementsByTagName("mime")[0]?.textContent?.trim();
    if (fileName) {
      lines.push(`[Attachment: ${fileName}${mime ? ` (${mime})` : ""}]`);
    }
  }
  return lines;
}

function parseNoteElement(noteEl: Element, index: number): Partial<RecallNote> | null {
  const title = childText(noteEl, "title") || "Untitled";
  const guid =
    childText(noteEl, "guid") ||
    noteEl.getElementsByTagName("guid")[0]?.textContent?.trim();
  const created = childText(noteEl, "created");
  const updated = childText(noteEl, "updated");

  const contentNodes = noteEl.getElementsByTagName("content");
  let rawContent = "";
  for (let i = 0; i < contentNodes.length; i++) {
    if (contentNodes[i]!.parentElement === noteEl) {
      rawContent = contentNodes[i]!.textContent ?? "";
      break;
    }
  }

  let content = enmlToPlainText(rawContent);
  const attachments = attachmentLines(noteEl);
  if (attachments.length > 0) {
    content = content
      ? `${content}\n\n---\n${attachments.join("\n")}`
      : attachments.join("\n");
  }

  const tags = childTags(noteEl);
  const stableKey = hashNoteKey(title, created ?? updated ?? "", index);
  const id = guid ? `note-en-${guid}` : `note-en-${stableKey}`;

  return {
    id,
    title,
    content,
    preview: previewFromContent(content),
    tags,
    date: evernoteDateLabel(updated || created),
    pinned: false,
  };
}

export function parseEnex(xml: string, sourceName?: string): EvernoteImportResult {
  const errors: string[] = [];
  const notes: Partial<RecallNote>[] = [];

  const trimmed = stripExportPrologue(xml);
  if (!trimmed) {
    return { notes, errors: [sourceName ? `${sourceName}: file is empty` : "File is empty"] };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(trimmed, "text/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    return {
      notes,
      errors: [
        sourceName
          ? `${sourceName}: invalid Evernote export format`
          : "Invalid Evernote export format",
      ],
    };
  }

  const exportRoot = doc.getElementsByTagName("en-export")[0] ?? doc.documentElement;
  const noteElements = exportRoot.getElementsByTagName("note");
  if (noteElements.length === 0) {
    return {
      notes,
      errors: [
        sourceName
          ? `${sourceName}: no notes found (export a notebook as .enex from Evernote)`
          : "No notes found in file",
      ],
    };
  }

  for (let index = 0; index < noteElements.length; index++) {
    const noteEl = noteElements[index]!;
    try {
      const note = parseNoteElement(noteEl, index);
      if (note) notes.push(note);
    } catch {
      errors.push(
        sourceName
          ? `${sourceName}: could not read note ${index + 1}`
          : `Could not read note ${index + 1}`,
      );
    }
  }

  if (notes.length === 0 && noteElements.length > 0) {
    errors.push(
      sourceName
        ? `${sourceName}: found ${noteElements.length} notes but could not parse them`
        : `Found ${noteElements.length} notes but could not parse them`,
    );
  }

  return { notes, errors };
}

export async function parseEnexFiles(files: File[]): Promise<EvernoteImportResult> {
  const allNotes: Partial<RecallNote>[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".enex")) {
      errors.push(`${file.name}: not an .enex file (skipped)`);
      continue;
    }
    try {
      const xml = await file.text();
      const result = parseEnex(xml, file.name);
      allNotes.push(...result.notes);
      errors.push(...result.errors);
    } catch {
      errors.push(`${file.name}: could not read file`);
    }
  }

  return { notes: allNotes, errors };
}
