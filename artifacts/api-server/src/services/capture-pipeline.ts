import { and, desc, eq } from "drizzle-orm";
import { aiExtractions, captureItems } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newAiExtractionId, newCaptureId, newExtractionJobId } from "../lib/recall-format";
import {
  CLASSIFY_CAPTURE_PROMPT_VERSION,
} from "../prompts/classifyCapture.v2";
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
import { aiService } from "./ai";
import {
  autoAcceptEligible,
  normalizeCaptureTypes,
  resolveCaptureLinks,
  suggestedTypeToType,
} from "./capture-classify";
import { acceptCaptureForUser } from "./capture-items";

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
  const item = aiResult.item;
  const confidence =
    typeof item.confidence === "number"
      ? Math.min(1, Math.max(0, item.confidence))
      : aiResult.degraded
        ? 0.4
        : 0.75;
  const types = normalizeCaptureTypes(item.types, [suggestedTypeToType(item.suggestedType)]);
  const links = await resolveCaptureLinks(userId, {
    personName: item.personName,
    projectName: item.suggestedProject,
  });

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

  // Idempotent inbox upsert: one row per raw capture. Reprocessing refreshes a
  // still-pending row but never resurrects one the user already triaged.
  const metadata: Record<string, unknown> = {
    types,
    promptVersion: CLASSIFY_CAPTURE_PROMPT_VERSION,
    autoAccepted: false,
  };
  const classificationFields = {
    rawText: capture.rawText,
    cleanedTitle: item.cleanedTitle,
    suggestedType: item.suggestedType,
    suggestedPriority: item.suggestedPriority,
    suggestedDueDate: item.suggestedDueDate,
    suggestedProject: item.suggestedProject,
    suggestedTags: item.suggestedTags,
    suggestedActions: item.suggestedActions,
    confidence,
    suggestedLinks: links,
    metadata,
    updatedAt: now,
  };

  const findInboxRow = async () => {
    const rows = await getDb()
      .select({ id: captureItems.id, status: captureItems.status })
      .from(captureItems)
      .where(and(eq(captureItems.rawCaptureId, captureId), eq(captureItems.userId, userId)))
      .limit(1);
    return rows[0];
  };

  let inboxId: string;
  let alreadyTriaged = false;
  const existingRow = await findInboxRow();
  if (existingRow && existingRow.status !== "pending") {
    inboxId = existingRow.id;
    alreadyTriaged = true;
  } else if (existingRow) {
    await getDb().update(captureItems).set(classificationFields).where(eq(captureItems.id, existingRow.id));
    inboxId = existingRow.id;
  } else {
    inboxId = newCaptureId();
    try {
      await getDb().insert(captureItems).values({
        id: inboxId,
        userId,
        rawCaptureId: captureId,
        ...classificationFields,
        status: "pending",
        projectId: null,
        notebookId: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // A concurrent run won the insert race — adopt its row.
      const raced = await findInboxRow();
      if (!raced) throw new Error("capture inbox upsert failed");
      inboxId = raced.id;
      alreadyTriaged = raced.status !== "pending";
      if (!alreadyTriaged) {
        await getDb().update(captureItems).set(classificationFields).where(eq(captureItems.id, inboxId));
      }
    }
  }

  if (!alreadyTriaged) {
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
        types,
        suggestedLinks: links,
      },
    });

    // Promote a suggested due date onto the deadline radar (attention_items).
    // Reuses the classification's own date — no second LLM call.
    try {
      const { captureDueDatePromotion } = await import("./attention-extract");
      const { upsertAttentionItemForUser } = await import("./attention");
      const promotion = captureDueDatePromotion({
        suggestedDueDate: item.suggestedDueDate,
        confidence,
      });
      if (promotion) {
        await upsertAttentionItemForUser(userId, {
          title: (item.cleanedTitle ?? "Deadline").trim().slice(0, 500) || "Deadline",
          summary: item.evidenceText ?? capture.rawText.slice(0, 300),
          dueAt: promotion.dueAt,
          kind: "deadline",
          sourceEntityType: "capture_item",
          sourceEntityId: inboxId,
          evidenceText: item.evidenceText ?? capture.rawText.slice(0, 500),
          confidence,
          dateConfidence: promotion.dateConfidence,
          metadata: {
            extractedFrom: "capture",
            promptVersion: CLASSIFY_CAPTURE_PROMPT_VERSION,
            captureId,
          },
        });
      }
    } catch {
      // Deadline promotion must never break capture processing.
    }

    // High-confidence, low-risk captures organize themselves: materialize via
    // the same accept flow the user would trigger, flagged as automatic.
    if (autoAcceptEligible({ types, confidence, dueDate: item.suggestedDueDate, links })) {
      const personLink = links.find((l) => l.entityType === "person" && l.matched);
      const projectLink = links.find((l) => l.entityType === "project" && l.matched);
      const accepted = await acceptCaptureForUser(userId, inboxId, {
        personId: personLink?.entityId ?? undefined,
        projectId: projectLink?.entityId ?? undefined,
      });
      if (accepted) {
        await getDb()
          .update(captureItems)
          .set({ metadata: { ...metadata, autoAccepted: true }, updatedAt: new Date() })
          .where(eq(captureItems.id, inboxId));
        await writeAuditLog({
          userId,
          action: "capture_auto_accepted",
          entityType: accepted.task ? "task" : accepted.note ? "note" : accepted.memory ? "memory" : "capture_item",
          entityId: accepted.task?.id ?? accepted.note?.id ?? accepted.memory?.id ?? inboxId,
          metadata: { captureItemId: inboxId, captureId, confidence, types },
        });
      }
    }
  }

  await updateCaptureStatusForUser(userId, captureId, { processedStatus: "processed" });

  const { scheduleDigestRegen } = await import("./digests");
  scheduleDigestRegen({ userId, entityType: "capture", entityId: captureId });

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
