export function previewFromContent(content: string): string {
  const line = content.trim().split("\n").find(Boolean) ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

export function noteDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function newNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newCaptureId(): string {
  return `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Raw Capture Layer id. Distinct prefix (`cap-`) from `capture_items` (`capture-`). */
export function newRawCaptureId(): string {
  return `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newProjectId(): string {
  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newEvidenceId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newEmbeddingId(): string {
  return `emb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newAiExtractionId(): string {
  return `aix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newPersonId(): string {
  return `person-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newConnectorId(): string {
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newSyncRunId(): string {
  return `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newSourceRecordId(): string {
  return `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newDocumentId(): string {
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newKnowledgeId(): string {
  return `know-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newMemoryId(): string {
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newCorrectionId(): string {
  return `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newEntityLinkId(): string {
  return `elink-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newVehicleId(): string {
  return `vehicle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newWarrantyId(): string {
  return `warranty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newHomeId(): string {
  return `home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newOrganizationId(): string {
  return `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newInvoiceId(): string {
  return `invoice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newAuthSessionId(): string {
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newAuditId(): string {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newAskThreadId(): string {
  return `athread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newUserRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newAttentionId(): string {
  return `attn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newAskMessageId(): string {
  return `amsg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newExtractionJobId(): string {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
