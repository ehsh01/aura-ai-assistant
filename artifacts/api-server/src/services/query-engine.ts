import { listTasksForUser } from "./tasks";
import type { EvidenceDto } from "./evidence";
import { aiService, type QueryFinanceAggregate } from "./ai";
import { FINANCE_INTENT, todayIso } from "./query-utils";
import { loadSyncedFinanceAggregate } from "./finance-sync";
import { ensureUserFinanceFresh } from "./finance-auto-sync";
import { retrieveRelevantRecords } from "./retrieval";
import { listWaitingOnForUser } from "./waiting-on";
import { writeAuditLog } from "./audit";
import { QUERY_ANSWER_PROMPT_VERSION } from "../prompts/queryAnswer.v1";
import { newEvidenceId } from "../lib/recall-format";

const WAITING_INTENT =
  /\b(waiting|follow[- ]?up|awaiting|who.*(owe|owed|pending)|what.*(pending|waiting))\b/i;

export type QueryAnswer = {
  answer: string;
  confidence: number;
  caveats: string | null;
  evidence: EvidenceDto[];
  relatedRecords: { entityType: string; entityId: string; title: string }[];
  suggestedNextAction: string | null;
  promptVersion: string;
  degraded: boolean;
};

function makeEvidence(input: {
  claimType: string;
  evidenceText: string;
  metadata: Record<string, unknown>;
}): EvidenceDto {
  const now = new Date().toISOString();
  return {
    id: newEvidenceId(),
    entityType: "query_answer",
    entityId: "ephemeral",
    claimType: input.claimType,
    sourceCaptureId: null,
    sourceRecordId: null,
    evidenceText: input.evidenceText,
    evidenceMetadata: input.metadata,
    fileName: null,
    fileId: null,
    rowNumber: null,
    pageNumber: null,
    url: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Natural-language query with evidence-backed assembly.
 *
 * Retrieval is hybrid (keyword + cached embeddings). Finance answers use
 * already-synced source_records rather than a live external API call.
 * Reads are side-effect free: evidence is assembled in-memory.
 */
export async function queryRecallForUser(
  userId: string,
  question: string,
): Promise<QueryAnswer> {
  const today = todayIso();
  const degraded = aiService.getStatus().degraded;
  const waitingIntent = WAITING_INTENT.test(question);

  const [{ records: relevant, usedSemantic }, tasks, waitingItems] = await Promise.all([
    retrieveRelevantRecords(userId, question, 12),
    listTasksForUser(userId),
    waitingIntent ? listWaitingOnForUser(userId, 12) : Promise.resolve([]),
  ]);
  const openTasks = tasks.filter((t) => !t.completed);

  let finance: QueryFinanceAggregate | null = null;
  let financeNeedsSync = false;
  const evidence: EvidenceDto[] = [];

  if (waitingItems.length > 0) {
    for (const w of waitingItems.slice(0, 6)) {
      evidence.push(
        makeEvidence({
          claimType: "summary_based_on",
          evidenceText: `${w.person}: ${w.item} — ${w.evidenceText}`,
          metadata: {
            relatedEntityType: w.sourceType,
            relatedEntityId: w.id,
            person: w.person,
            days: w.days,
            retrievalMethod: "waiting_on",
          },
        }),
      );
    }
  }

  if (FINANCE_INTENT.test(question)) {
    ensureUserFinanceFresh(userId);
    try {
      const synced = await loadSyncedFinanceAggregate(userId, question, today);
      if (synced) {
        finance = synced.finance;
        financeNeedsSync = synced.needsSync;
        evidence.push(
          makeEvidence({
            claimType: "amount_calculated_from",
            evidenceText: synced.needsSync
              ? "Finance connector is configured but no transactions are synced yet. Sync on Connectors first."
              : `Net total ${finance.total} across ${finance.count} transaction(s)${
                  finance.rangeLabel ? ` for ${finance.rangeLabel}` : ""
                }. Source: synced MyFamilyBudget records in Recall.`,
            metadata: {
              rangeLabel: finance.rangeLabel,
              topPayees: finance.topPayees.slice(0, 5),
              topCategories: finance.topCategories.slice(0, 5),
              connectorId: synced.connectorId,
              payeeFilter: synced.payeeFilter,
              needsSync: synced.needsSync,
              source: "synced_source_records",
            },
          }),
        );
      }
    } catch {
      // Finance data unavailable — proceed without it.
    }
  }

  if (waitingItems.length === 0) {
    for (const rec of relevant.slice(0, 5)) {
      evidence.push(
        makeEvidence({
          claimType: "summary_based_on",
          evidenceText: rec.text.slice(0, 500),
          metadata: {
            relatedEntityType: rec.entityType,
            relatedEntityId: rec.entityId,
            retrievalScore: Number(rec.score.toFixed(4)),
            retrievalMethod: rec.method,
            usedSemantic,
          },
        }),
      );
    }
  }

  const relatedRecords =
    waitingItems.length > 0
      ? waitingItems.map((w) => ({
          entityType: w.sourceType,
          entityId: w.id,
          title: `${w.person}: ${w.item}`,
        }))
      : relevant.map((r) => ({
          entityType: r.entityType,
          entityId: r.entityId,
          title: r.title,
        }));

  const contextRecords =
    waitingItems.length > 0
      ? waitingItems.map((w) => ({
          entityType: w.sourceType,
          entityId: w.id,
          title: `${w.person}: ${w.item}`,
          text: `${w.followUp}. ${w.evidenceText}${w.days ? ` (${w.days}d)` : ""}`,
        }))
      : relevant.map((r) => ({
          entityType: r.entityType,
          entityId: r.entityId,
          title: r.title,
          text: r.text,
        }));

  const finish = async (result: QueryAnswer): Promise<QueryAnswer> => {
    await writeAuditLog({
      userId,
      action: "query_answered",
      entityType: "query",
      entityId: null,
      metadata: {
        question: question.slice(0, 240),
        confidence: result.confidence,
        evidenceCount: result.evidence.length,
        usedSemantic,
        waitingCount: waitingItems.length,
        hasFinance: Boolean(finance && !financeNeedsSync),
      },
    });
    return result;
  };

  // AI synthesis when available.
  if (!degraded) {
    try {
      const ai = await aiService.answerQuery({
        question,
        today,
        records: contextRecords,
        finance: financeNeedsSync ? null : finance,
      });
      let caveats = ai.caveats;
      if (financeNeedsSync) {
        caveats = [caveats, "Finance data needs a sync on Connectors before totals are reliable."]
          .filter(Boolean)
          .join(" ");
      }
      return finish({
        answer: ai.answer,
        confidence: ai.confidence,
        caveats,
        evidence,
        relatedRecords,
        suggestedNextAction:
          ai.suggestedNextAction ??
          (waitingItems.length > 0 ? "Open People → Waiting on" : null),
        promptVersion: QUERY_ANSWER_PROMPT_VERSION,
        degraded: ai.degraded,
      });
    } catch {
      // Fall through to rule-based answer.
    }
  }

  // Deterministic fallback.
  let answer: string;
  let confidence = relevant.length > 0 || (finance && !financeNeedsSync) ? 0.6 : 0.3;
  let caveats: string | null =
    relevant.length === 0 && !finance ? "Limited matching records found." : null;
  let suggestedNextAction: string | null = null;

  if (financeNeedsSync) {
    answer =
      "Your finance connector is set up, but no transactions are synced yet. Open Connectors and sync Finance, then ask again.";
    confidence = 0.4;
    caveats = "No synced finance records.";
    suggestedNextAction = "Open Connectors → Sync Finance";
  } else if (finance) {
    const topPayee = finance.topPayees[0];
    answer =
      `Net total is $${finance.total.toFixed(2)} across ${finance.count} transaction(s)` +
      `${finance.rangeLabel ? ` for ${finance.rangeLabel}` : ""}.` +
      (topPayee ? ` Largest: ${topPayee.payee} ($${topPayee.total.toFixed(2)}).` : "");
    confidence = 0.85;
    suggestedNextAction = "Open Connectors → Finance for the full breakdown";
  } else if (waitingItems.length > 0) {
    const lines = waitingItems
      .slice(0, 5)
      .map((w) => `• ${w.person}: ${w.item}${w.days ? ` (${w.days}d)` : ""}`);
    answer = `You're waiting on ${waitingItems.length} follow-up${
      waitingItems.length === 1 ? "" : "s"
    }:\n${lines.join("\n")}`;
    confidence = 0.85;
    suggestedNextAction = "Open People → Waiting on";
  } else if (/attention|today|focus|do today/i.test(question)) {
    const dueToday = openTasks.filter((t) => t.time && t.time.startsWith(today));
    const high = openTasks.filter((t) => t.priority === "high");
    const focus = dueToday[0] ?? high[0] ?? openTasks[0];
    answer = focus
      ? `Focus on "${focus.title}"${focus.time ? ` (due ${focus.time})` : ""}. You have ${openTasks.length} open task(s) total.`
      : `You have ${openTasks.length} open task(s). Nothing is marked due today.`;
    confidence = 0.85;
    suggestedNextAction = focus ? `Open task: ${focus.title}` : "Review your task list";
  } else if (relevant.length > 0) {
    answer = `I found ${relevant.length} related record(s)${
      usedSemantic ? " (semantic match)" : ""
    }. Top match: "${relevant[0]!.title}". ${relevant[0]!.text.slice(0, 200)}`;
    suggestedNextAction = `Review ${relevant[0]!.entityType}: ${relevant[0]!.title}`;
  } else {
    answer =
      "I don't have enough matching records to answer confidently. Try capturing more context or connecting a data source.";
    confidence = 0.2;
  }

  return finish({
    answer,
    confidence,
    caveats,
    evidence,
    relatedRecords,
    suggestedNextAction,
    promptVersion: QUERY_ANSWER_PROMPT_VERSION,
    degraded,
  });
}
