import type { EvidenceDto } from "./evidence";

export type PersistedAskAnswerMetadata = {
  confidence: number;
  caveats: string | null;
  relatedRecords: { entityType: string; entityId: string; title: string }[];
  evidence: EvidenceDto[];
  privacy: {
    model: string | null;
    dataLeftDevice: boolean;
    categoriesSent: string[];
  };
  suggestedNextAction: string | null;
  promptVersion: string;
  degraded: boolean;
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
    privacy: answer.privacy,
    suggestedNextAction: answer.suggestedNextAction,
    promptVersion: answer.promptVersion,
    degraded: answer.degraded,
  };
}
