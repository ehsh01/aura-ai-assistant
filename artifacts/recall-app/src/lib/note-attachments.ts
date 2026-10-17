export type NoteAttachmentMeta = {
  id: string;
  noteId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  hasExtractedText: boolean;
  aiOcrProcessed: boolean;
};

export async function fetchNoteAttachments(noteId: string): Promise<NoteAttachmentMeta[]> {
  const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}/attachments`, {
    credentials: "include",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { attachments?: NoteAttachmentMeta[] };
  return data.attachments ?? [];
}

export function attachmentUrl(attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}`;
}

export async function fetchAttachmentBlob(attachmentId: string): Promise<Blob | null> {
  const res = await fetch(attachmentUrl(attachmentId), {
    credentials: "include",
  });
  if (!res.ok) return null;
  return res.blob();
}

export async function extractAttachmentTextWithAi(
  attachmentId: string,
): Promise<{ text: string | null; cached: boolean }> {
  const res = await fetch(`/api/attachments/${encodeURIComponent(attachmentId)}/extract-text-ai`, {
    method: "POST",
    credentials: "include",
  });
  const data = (await res.json().catch(() => ({}))) as {
    text?: string | null;
    cached?: boolean;
    message?: string;
  };
  if (!res.ok) throw new Error(data.message ?? "Could not extract text with AI");
  return { text: data.text ?? null, cached: Boolean(data.cached) };
}
