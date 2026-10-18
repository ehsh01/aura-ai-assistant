import { getItemForUser } from "./items";
import type { QueryAnswer } from "./query-engine";

export const VOICE_NO_MATCH_REPLY = "I couldn't find that in your notes.";
export const VOICE_LIMIT_REPLY =
  "Daily voice limit reached. Free search still works.";

export type VoiceAnswerSource = {
  itemId: string;
  title: string;
  notebook: string | null;
  date: string | null;
};

function itemIdFor(entityType: string, entityId: string): string | null {
  if (entityType === "note") return `note:${entityId}`;
  if (entityType === "source_record" || entityType === "evernote_note") {
    return `evernote:${entityId}`;
  }
  return null;
}

function spokenDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(date);
}

function shortSpokenBody(raw: string): string {
  const plain = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~]+/g, " ")
    .replace(/\s*[\r\n]+\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = plain.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  return sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ")
    .slice(0, 420)
    .trim();
}

export async function buildVoiceAnswer(
  userId: string,
  result: QueryAnswer,
): Promise<{ answer: string; sources: VoiceAnswerSource[] }> {
  const candidates = [
    ...result.relatedRecords,
    ...result.evidence.map((evidence) => ({
      entityType: evidence.entityType,
      entityId: evidence.entityId,
      title:
        typeof evidence.evidenceMetadata?.sourceTitle === "string"
          ? evidence.evidenceMetadata.sourceTitle
          : evidence.evidenceText,
    })),
  ];

  const seen = new Set<string>();
  const sourceIds = candidates
    .map((candidate) => itemIdFor(candidate.entityType, candidate.entityId))
    .filter((id): id is string => Boolean(id))
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, 5);

  const loaded = await Promise.all(
    sourceIds.map(async (itemId) => {
      try {
        return await getItemForUser(userId, itemId);
      } catch {
        return null;
      }
    }),
  );
  const sources = loaded
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({
      itemId: item.id,
      title: item.title,
      notebook: item.notebook,
      date: item.bumpedAt || item.updatedAt || item.createdAt || null,
    }));

  if (sources.length === 0) {
    return { answer: VOICE_NO_MATCH_REPLY, sources: [] };
  }

  const body = shortSpokenBody(result.answer);
  const primary = sources[0]!;
  const date = spokenDate(primary.date);
  const attribution = `From your note ${primary.title}${date ? `, ${date}` : ""}.`;
  return {
    answer: body
      ? `${body.replace(/[.!?]+$/, "")}. ${attribution}`
      : attribution,
    sources,
  };
}
