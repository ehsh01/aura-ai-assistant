export type NoteAttachmentMeta = {
  id: string;
  noteId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
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
