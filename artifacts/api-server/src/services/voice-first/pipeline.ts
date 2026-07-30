/**
 * Voice First capture pipeline facade.
 * Typed (and post-transcription) text enters here and reuses planActionsForText.
 */
import { planActionsForText, type PlanResult } from "../action-orchestrator";
import { getBriefingPrefsForUser } from "../notification-settings";
import { recallTimezone } from "../query-utils";
import { writeAuditLog } from "../audit";
import { resolveTemporalExpression } from "./temporal";
import { resolveVoiceEntities, type VoiceEntityLinks } from "./resolve-entities";
import type { VoiceCaptureInput } from "./types";

export type VoicePlanResult = PlanResult & {
  temporal: ReturnType<typeof resolveTemporalExpression>;
  timezone: string;
  /** Person/project mentions resolved against the user's own records. */
  links: VoiceEntityLinks;
};

/**
 * Receive conversational capture text and draft actions via the existing orchestrator.
 * Applies morning/evening temporal defaults onto reminder drafts when missing a clock.
 */
export async function receiveVoiceCapture(input: VoiceCaptureInput): Promise<VoicePlanResult> {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) {
    throw Object.assign(new Error("Text is required"), { status: 400 });
  }

  const prefs = await getBriefingPrefsForUser(input.userId).catch(() => null);
  const timezone = input.timezone?.trim() || prefs?.timezone || recallTimezone();
  const now = input.clientTimestamp ? new Date(input.clientTimestamp) : new Date();
  const temporal = resolveTemporalExpression(text, { now, timeZone: timezone });

  const plan = await planActionsForText(input.userId, text, {
    threadId: input.sessionId ?? null,
  });

  // Enrich reminder drafts that lack a due date when we resolved one temporally.
  if (temporal.dueAt && plan.actions.length > 0) {
    for (const action of plan.actions) {
      if (action.type === "create_reminder" && !action.draft.dueAt) {
        action.draft.dueAt = temporal.dueAt;
        action.reason = temporal.explanation
          ? `${action.reason} ${temporal.explanation}`
          : action.reason;
      }
    }
  }

  const links = await resolveVoiceEntities(input.userId, {
    personName: plan.mentions?.personName ?? null,
    projectName: plan.mentions?.projectName ?? null,
  });

  // Only unambiguous matches become links. Ambiguous mentions stay unlinked so
  // the user is asked rather than attached to the wrong John.
  const personId = links.person?.status === "resolved" ? links.person.id : null;
  const projectId = links.project?.status === "resolved" ? links.project.id : null;
  if (personId || projectId) {
    for (const action of plan.actions) {
      action.draft.personId = personId;
      action.draft.projectId = projectId;
      const linked = [links.person, links.project]
        .filter((l) => l?.status === "resolved")
        .map((l) => l!.name)
        .join(" and ");
      if (linked) action.reason = `${action.reason} Linked to ${linked}.`;
    }
  }

  await writeAuditLog({
    userId: input.userId,
    action: "voice_capture_planned",
    entityType: "capture",
    entityId: plan.rawCaptureId,
    metadata: {
      source: input.source,
      temporalBasis: temporal.basis,
      timezone,
      actionCount: plan.actions.length,
      mode: plan.mode,
      // Never log raw transcript content.
      textLength: text.length,
      idempotencyKey: input.idempotencyKey ?? null,
      personStatus: links.person?.status ?? null,
      projectStatus: links.project?.status ?? null,
    },
  });

  return { ...plan, temporal, timezone, links };
}
