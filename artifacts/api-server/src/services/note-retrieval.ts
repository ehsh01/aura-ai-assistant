export type NoteRetrievalSource = {
  title: string;
  content?: string | null;
  preview?: string | null;
  tags?: string[] | null;
  attachmentText?: string | null;
  primaryPersonId?: string | null;
  primaryPersonName?: string | null;
};

function plainText(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Canonical note text used by Ask keyword and semantic retrieval.
 * Attachment text remains generous for exact matches while the leading body
 * and attachment excerpt fit inside the embedding service's 2,000-char cap.
 */
export function noteRetrievalText(note: NoteRetrievalSource): string {
  const body = plainText(note.content || note.preview || "").slice(0, 1_000);
  const attachments = plainText(note.attachmentText || "").slice(0, 4_000);
  const tags = (note.tags ?? []).join(",");
  const personBits = [note.primaryPersonName, note.primaryPersonId]
    .filter(Boolean)
    .join(" ");

  return [
    note.title.trim(),
    body,
    attachments ? `attachments:\n${attachments}` : "",
    `tags=${tags}${personBits ? ` person=${personBits}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}
