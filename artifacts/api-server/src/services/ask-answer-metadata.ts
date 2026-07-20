import type { EvidenceDto } from "./evidence";
import type { AskAnswerImage } from "./ask-images";
import type { SourceConsulted } from "./ask-accuracy-policy";

export type PersistedAskAnswerMetadata = {
  confidence: number;
  caveats: string | null;
  relatedRecords: { entityType: string; entityId: string; title: string }[];
  evidence: EvidenceDto[];
  images: AskAnswerImage[];
  privacy: {
    model: string | null;
    dataLeftDevice: boolean;
    categoriesSent: string[];
  };
  suggestedNextAction: string | null;
  promptVersion: string;
  degraded: boolean;
  sourcesConsulted?: SourceConsulted[];
};

/** Preserve the exact source snapshots used for an answer in its thread row. */
export function buildAskAnswerMetadata(
  answer: PersistedAskAnswerMetadata,
): PersistedAskAnswerMetadata {
  return {
    confidence: answer.confidence,
    caveats: answer.caveats,
    relatedRecords: answer.relatedRecords.slice(0, 8),
    evidence: answer.evidence,
    images: (answer.images ?? []).slice(0, 6),
    privacy: answer.privacy,
    suggestedNextAction: answer.suggestedNextAction,
    promptVersion: answer.promptVersion,
    degraded: answer.degraded,
    sourcesConsulted: (answer.sourcesConsulted ?? []).slice(0, 8),
  };
}
