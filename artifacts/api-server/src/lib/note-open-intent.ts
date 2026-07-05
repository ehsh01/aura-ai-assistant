import type { RecallNoteMetadataDto } from "../services/notes";

/** True when the user is trying to locate or view a note, not summarize or compose. */
export function userWantsNoteOpened(message: string): boolean {
  const m = message.toLowerCase().trim();
  if (!m) return false;

  if (
    /\b(summarize|summary|explain|describe|compare|list all|how many|draft|write|edit|brainstorm)\b/.test(
      m,
    )
  ) {
    return false;
  }

  if (
    /\b(show|open|pull up|bring up|display|view|find|get me|see my|look at|where is|where's|locate)\b/.test(
      m,
    )
  ) {
    return true;
  }

  // Short lookups like "Porsche registration" or "purchase registration"
  return m.split(/\s+/).filter(Boolean).length <= 10;
}

/** Prefer rich notes with attachments when several titles match. */
export function pickBestNoteToOpen(
  notes: RecallNoteMetadataDto[],
): RecallNoteMetadataDto | null {
  if (notes.length === 0) return null;

  return [...notes].sort((a, b) => {
    const score = (n: RecallNoteMetadataDto) =>
      (n.contentFormat === "html" ? 4 : 0) +
      (n.attachmentCount ?? 0) * 2 +
      Math.min((n.preview?.length ?? 0) / 50, 3);
    return score(b) - score(a);
  })[0]!;
}
