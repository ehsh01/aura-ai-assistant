/**
 * When the user asks to see a saved photo/scan, surface note attachment images
 * in Ask metadata so the chat UI can render them (OCR text alone is not enough).
 */

export type AskAnswerImage = {
  attachmentId: string;
  noteId: string;
  noteTitle: string;
  fileName: string;
  mimeType: string;
};

/** User wants the actual image shown, not only OCR/extracted text. */
export function wantsShowSavedImage(question: string): boolean {
  return /\b(show|see|look\s+at|display|view|open|pull\s+up)\b.{0,40}\b(pic(?:ture)?|photo|image|scan|screenshot|jpeg|jpg|png|registration|title\s*(?:photo|image|pic)|license|id\s*card|receipt)\b/i.test(
    question,
  ) || /\b(pic(?:ture)?|photo|image|scan|screenshot)\b.{0,40}\b(of|for|from|showing|with)\b/i.test(
    question,
  ) || /\b(my|the)\s+(registration|title|license|passport|id|receipt|warranty)\s+(pic(?:ture)?|photo|image|scan)\b/i.test(
    question,
  );
}

export function noteIdsForAskImages(
  records: { entityType: string; entityId: string }[],
  limit = 8,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (r.entityType !== "note") continue;
    if (seen.has(r.entityId)) continue;
    seen.add(r.entityId);
    ids.push(r.entityId);
    if (ids.length >= limit) break;
  }
  return ids;
}
