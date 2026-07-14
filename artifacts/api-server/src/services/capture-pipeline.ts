import { and, desc, eq } from "drizzle-orm";
import { aiExtractions, captureItems } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newAiExtractionId, newCaptureId, newExtractionJobId } from "../lib/recall-format";
import {
  CLASSIFY_CAPTURE_PROMPT_VERSION,
} from "../prompts/classifyCapture.v1";
import { writeAuditLog } from "./audit";
import { createCaptureForUser, getCaptureForUser, updateCaptureStatusForUser } from "./captures";
import { createEvidenceForUser } from "./evidence";
import {
  JOB_TYPE_CAPTURE_EXTRACTION,
  captureIdFromPayload,
  enqueueJob,
  getJobForUser,
} from "./job-queue";
import { nudgeJobWorker } from "./job-worker";
import { resolvePersonByName } from "./people";
import { aiService } from "./ai";
import type { CaptureClassificationItem } from "./ai";

type ExtendedClassification = CaptureClassificationItem & {
  confidence?: number;
  requesterName?: string | null;
  evidenceText?: string;
};

function confidenceLabel(score: number | null | undefined): "high" | "needs_review" | "uncertain" {
  if (score == null) return "uncertain";
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "needs_review";
  return "uncertain";
}

/** Queue async extraction for a raw capture (durable DB job). */
export async function queueCaptureExtraction(
  userId: string,
  captureId: string,
): Promise<{ jobId: string }> {
  const jobId = newExtractionJobId();
  await enqueueJob({
    id: jobId,
    userId,
    type: JOB_TYPE_CAPTURE_EXTRACTION,
    payload: { captureId },
  });
  nudgeJobWorker();
  return { jobId };
}

/**
 * Full pipeline: raw capture → AI extraction record → inbox suggestion → evidence.
 * Does NOT block callers; invoked by the job runner.
 */
export async function processCaptureExtraction(
  userId: string,
  captureId: string,
): Promise<void> {
  const capture = await getCaptureForUser(userId, captureId);
  if (!capture) throw new Error("Capture not found");

  const existingExtraction = await getLatestExtractionForCapture(userId, captureId);
  if (existingExtraction && capture.processedStatus === "processed") {
    return;
  }

  await updateCaptureStatusForUser(userId, captureId, { processedStatus: "processing" });

  const aiResult = await aiService.classifyCapture({ rawText: capture.rawText });
  const item = aiResult.item as ExtendedClassification;
  const confidence =
    typeof item.confidence === "number"
      ? Math.min(1, Math.max(0, item.confidence))
      : aiResult.degraded
        ? 0.4
        : 0.75;

  const now = new Date();
  const extractionId = newAiExtractionId();
  await getDb().insert(aiExtractions).values({
    id: extractionId,
    userId,
    captureId,
    modelName: aiResult.degraded ? null : "gpt-4o-mini",
    promptVersion: CLASSIFY_CAPTURE_PROMPT_VERSION,
    rawResponse: JSON.stringify(aiResult),
    structuredOutput: item as unknown as Record<string, unknown>,
    confidenceScore: confidence,
    status: confidenceLabel(confidence) === "high" ? "suggested" : "needs_review",
    errorMessage: aiResult.degraded ? aiResult.degradedReason ?? null : null,
    createdAt: now,
    updatedAt: now,
  });

  const inboxId = newCaptureId();
  await getDb().insert(captureItems).values({
    id: inboxId,
    userId,
    rawCaptureId: captureId,
    rawText: capture.rawText,
    cleanedTitle: item.cleanedTitle,
    suggestedType: item.suggestedType,
    suggestedPriority: item.suggestedPriority,
    suggestedDueDate: item.suggestedDueDate,
    suggestedProject: item.suggestedProject,
    suggestedTags: item.suggestedTags,
    suggestedActions: item.suggestedActions,
    status: "pending",
    projectId: null,
    notebookId: null,
    createdAt: now,
    updatedAt: now,
  });

  await createEvidenceForUser(userId, {
    entityType: "capture_item",
    entityId: inboxId,
    claimType: "summary_based_on",
    sourceCaptureId: captureId,
    evidenceText: item.evidenceText ?? capture.rawText.slice(0, 500),
    url: capture.sourceUrl,
    evidenceMetadata: {
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      extractionId,
      promptVersion: CLASSIFY_CAPTURE_PROMPT_VERSION,
    },
  });

  if (item.requesterName?.trim()) {
    await resolvePersonByName(userId, item.requesterName.trim());
  }

  await updateCaptureStatusForUser(userId, captureId, { processedStatus: "processed" });

  await writeAuditLog({
    userId,
    action: "capture_extracted",
    entityType: "capture",
    entityId: captureId,
    metadata: { extractionId, inboxId, confidence },
  });
}

/** Convenience: create raw capture and queue extraction in one call. */
export async function ingestCaptureForUser(
  userId: string,
  input: Parameters<typeof createCaptureForUser>[1],
): Promise<{ capture: Awaited<ReturnType<typeof createCaptureForUser>>; jobId: string }> {
  const capture = await createCaptureForUser(userId, input);
  const { jobId } = await queueCaptureExtraction(userId, capture.id);
  await writeAuditLog({
    userId,
    action: "capture_created",
    entityType: "capture",
    entityId: capture.id,
    metadata: { sourceType: capture.sourceType, jobId },
  });
  return { capture, jobId };
}

export async function getExtractionJobStatus(
  userId: string,
  jobId: string,
): Promise<{ jobId: string; status: string; captureId?: string; error?: string } | null> {
  const job = await getJobForUser(userId, jobId);
  if (!job) return null;
  return {
    jobId: job.id,
    status: job.status,
    captureId: captureIdFromPayload(job.payload) ?? undefined,
    error: job.lastError ?? undefined,
  };
}

export async function retryCaptureExtraction(
  userId: string,
  captureId: string,
): Promise<{ jobId: string }> {
  await updateCaptureStatusForUser(userId, captureId, {
    processedStatus: "pending",
    processingError: null,
  });
  return queueCaptureExtraction(userId, captureId);
}

/** Find extraction for a capture. */
export async function getLatestExtractionForCapture(
  userId: string,
  captureId: string,
): Promise<{ id: string; confidenceScore: number | null; status: string } | null> {
  const rows = await getDb()
    .select({
      id: aiExtractions.id,
      confidenceScore: aiExtractions.confidenceScore,
      status: aiExtractions.status,
    })
    .from(aiExtractions)
    .where(and(eq(aiExtractions.captureId, captureId), eq(aiExtractions.userId, userId)))
    .orderBy(desc(aiExtractions.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    confidenceScore: row.confidenceScore ?? null,
    status: row.status,
  };
}
