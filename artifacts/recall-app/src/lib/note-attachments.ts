import { getStoredToken } from "@/lib/auth-storage";

export type NoteAttachmentMeta = {
  id: string;
  noteId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
};

async function authHeaders(): Promise<HeadersInit> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchNoteAttachments(noteId: string): Promise<NoteAttachmentMeta[]> {
  const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}/attachments`, {
    headers: await authHeaders(),
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
    headers: await authHeaders(),
  });
  if (!res.ok) return null;
  return res.blob();
}
