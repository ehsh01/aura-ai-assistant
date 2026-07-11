import { listTasksForUser } from "./tasks";
import type { EvidenceDto } from "./evidence";
import { aiService, type QueryFinanceAggregate } from "./ai";
import {
  FINANCE_INTENT,
  FAMILY_RELATION_INTENT,
  PERSON_INTENT,
  WAITING_INTENT,
  todayIso,
} from "./query-utils";
import { loadSyncedFinanceAggregate } from "./finance-sync";
import { ensureUserFinanceFresh } from "./finance-auto-sync";
import { retrieveRelevantRecords } from "./retrieval";
import { listWaitingOnForUser } from "./waiting-on";
import { writeAuditLog } from "./audit";
import { QUERY_ANSWER_PROMPT_VERSION } from "../prompts/queryAnswer.v1";
import { newEvidenceId } from "../lib/recall-format";
import {
  appendAskMessage,
  ensureAskThreadForUser,
  listRecentTurnsForThread,
  retrievalQueryFromHistory,
  type ConversationTurn,
} from "./ask-threads";

export type QueryAnswer = {
  answer: string;
  confidence: number;
  caveats: string | null;
  evidence: EvidenceDto[];
  relatedRecords: { entityType: string; entityId: string; title: string }[];
  suggestedNextAction: string | null;
  promptVersion: string;
  degraded: boolean;
  threadId: string | null;
  privacy: {
    model: string | null;
    dataLeftDevice: boolean;
    categoriesSent: string[];
  };
};

function makeEvidence(input: {
  claimType: string;
  evidenceText: string;
  metadata: Record<string, unknown>;
  /** Prefer the source record so UI deep-links resolve. */
  entityType?: string;
  entityId?: string;
}): EvidenceDto {
  const now = new Date().toISOString();
  const relatedType =
    typeof input.metadata.relatedEntityType === "string"
      ? input.metadata.relatedEntityType
      : null;
  const relatedId =
    typeof input.metadata.relatedEntityId === "string"
      ? input.metadata.relatedEntityId
      : null;
  return {
    id: newEvidenceId(),
    entityType: input.entityType ?? relatedType ?? "query_answer",
    entityId: input.entityId ?? relatedId ?? "ephemeral",
    claimType: input.claimType,
    sourceCaptureId: null,
    sourceRecordId: relatedId,
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
 * When threadId is provided (or created), prior turns are used for follow-ups
 * and the Q&A is persisted on the thread.
 */
export async function queryRecallForUser(
  userId: string,
  question: string,
  options?: { threadId?: string | null },
): Promise<QueryAnswer> {
  const today = todayIso();
  const status = aiService.getStatus();
  const degraded = status.degraded;
  const waitingIntent = WAITING_INTENT.test(question);
  const personIntent = PERSON_INTENT.test(question);
  const familyIntent = FAMILY_RELATION_INTENT.test(question);

  const thread = await ensureAskThreadForUser(userId, options?.threadId, question);
  const priorTurns = await listRecentTurnsForThread(userId, thread.id);
  const conversation: ConversationTurn[] = priorTurns;
  const retrievalQuestion = retrievalQueryFromHistory(question, conversation);

  await appendAskMessage({
    userId,
    threadId: thread.id,
    role: "user",
    content: question,
  });

  const [
    { records: relevantRaw, usedSemantic, namedPeople },
    tasks,
    waitingRaw,
  ] = await Promise.all([
    retrieveRelevantRecords(userId, retrievalQuestion, familyIntent ? 16 : 12),
    listTasksForUser(userId),
    waitingIntent || personIntent
      ? listWaitingOnForUser(userId, 12)
      : Promise.resolve([]),
  ]);

  // Prefer Life Memories for family/relation questions so names aren't crowded out.
  const relevant = familyIntent
    ? [...relevantRaw].sort((a, b) => {
        const aMem = a.entityType === "memory" ? 1 : 0;
        const bMem = b.entityType === "memory" ? 1 : 0;
        if (aMem !== bMem) return bMem - aMem;
        return b.score - a.score;
      })
    : relevantRaw;
  const openTasks = tasks.filter((t) => !t.completed);

  // When asking about a specific person, only keep their waiting items.
  const namedIds = new Set(namedPeople.map((p) => p.id));
  const namedNames = namedPeople.map((p) => p.displayName.toLowerCase());
  const waitingItems =
    personIntent && namedPeople.length > 0
      ? waitingRaw.filter((w) => {
          if (w.personId && namedIds.has(w.personId)) return true;
          const lower = w.person.toLowerCase();
          return namedNames.some(
            (n) => lower === n || lower.includes(n) || n.includes(lower),
          );
        })
      : waitingRaw;

  // Pure waiting questions can focus on waiting; person-about always keeps retrieval.
  const waitingOnly = waitingIntent && !personIntent && waitingItems.length > 0;
  const includeRetrieval = !waitingOnly;

  let finance: QueryFinanceAggregate | null = null;
  let financeNeedsSync = false;
  const evidence: EvidenceDto[] = [];

  if (waitingItems.length > 0) {
    for (const w of waitingItems.slice(0, personIntent ? 3 : 6)) {
      // Waiting ids are "note:uuid" / "knowledge:uuid" / "task:uuid".
      const bareId = w.id.includes(":") ? w.id.slice(w.id.indexOf(":") + 1) : w.id;
      evidence.push(
        makeEvidence({
          claimType: "summary_based_on",
          evidenceText: `${w.person}: ${w.item} — ${w.evidenceText}`,
          entityType: w.sourceType,
          entityId: bareId,
          metadata: {
            relatedEntityType: w.sourceType,
            relatedEntityId: bareId,
            person: w.person,
            personName: w.person,
            personId: w.personId,
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

  if (includeRetrieval) {
    const retrievalSlots = familyIntent
      ? 10
      : personIntent
        ? Math.max(3, 6 - Math.min(waitingItems.length, 3))
        : 5;
    for (const rec of relevant.slice(0, retrievalSlots)) {
      const personMeta =
        rec.entityType === "person"
          ? { personId: rec.entityId, personName: rec.title, person: rec.title }
          : rec.matchedPersonId || rec.matchedPersonName
            ? {
                personId: rec.matchedPersonId ?? null,
                personName: rec.matchedPersonName ?? null,
                person: rec.matchedPersonName ?? null,
              }
            : {};
      evidence.push(
        makeEvidence({
          claimType: "summary_based_on",
          evidenceText: rec.text.slice(0, 500),
          entityType: rec.entityType,
          entityId: rec.entityId,
          metadata: {
            relatedEntityType: rec.entityType,
            relatedEntityId: rec.entityId,
            retrievalScore: Number(rec.score.toFixed(4)),
            retrievalMethod: rec.method,
            usedSemantic,
            ...personMeta,
          },
        }),
      );
    }
  }

  const waitingRelated = waitingItems.map((w) => {
    const bareId = w.id.includes(":") ? w.id.slice(w.id.indexOf(":") + 1) : w.id;
    return {
      entityType: w.sourceType,
      entityId: bareId,
      title: `${w.person}: ${w.item}`,
    };
  });
  const retrievalRelated = relevant.map((r) => ({
    entityType: r.entityType,
    entityId: r.entityId,
    title: r.title,
  }));
  const relatedRecords = waitingOnly
    ? waitingRelated
    : [...waitingRelated, ...retrievalRelated].slice(0, 12);

  const waitingContext = waitingItems.map((w) => {
    const bareId = w.id.includes(":") ? w.id.slice(w.id.indexOf(":") + 1) : w.id;
    return {
      entityType: w.sourceType,
      entityId: bareId,
      title: `${w.person}: ${w.item}`,
      text: `${w.followUp}. ${w.evidenceText}${w.days ? ` (${w.days}d)` : ""}`,
    };
  });
  const retrievalContext = relevant.map((r) => ({
    entityType: r.entityType,
    entityId: r.entityId,
    title: r.title,
    text: r.text,
  }));
  const contextRecords = waitingOnly
    ? waitingContext
    : [...waitingContext, ...retrievalContext].slice(0, familyIntent ? 16 : 14);

  const finish = async (
    result: Omit<QueryAnswer, "privacy" | "threadId"> & {
      privacy?: QueryAnswer["privacy"];
      threadId?: string | null;
    },
  ): Promise<QueryAnswer> => {
    const categoriesSent = [
      ...new Set(
        [
          ...result.relatedRecords.map((r) => r.entityType),
          ...relevant.map((r) => r.entityType),
        ].filter(Boolean),
      ),
    ];
    const withPrivacy: QueryAnswer = {
      ...result,
      threadId: thread.id,
      privacy: result.privacy ?? {
        model: status.model,
        dataLeftDevice: !result.degraded && Boolean(status.enabled),
        categoriesSent,
      },
    };

    await appendAskMessage({
      userId,
      threadId: thread.id,
      role: "assistant",
      content: withPrivacy.answer,
      metadata: {
        confidence: withPrivacy.confidence,
        caveats: withPrivacy.caveats,
        relatedRecords: withPrivacy.relatedRecords.slice(0, 8),
      },
    });

    await writeAuditLog({
      userId,
      action: "query_answered",
      entityType: "query",
      entityId: thread.id,
      metadata: {
        question: question.slice(0, 240),
        threadId: thread.id,
        confidence: withPrivacy.confidence,
        evidenceCount: withPrivacy.evidence.length,
        usedSemantic,
        waitingCount: waitingItems.length,
        personIntent,
        namedPeople: namedPeople.map((p) => p.displayName).slice(0, 4),
        hasFinance: Boolean(finance && !financeNeedsSync),
        privacy: withPrivacy.privacy,
      },
    });
    return withPrivacy;
  };

  const defaultNext =
    namedPeople[0] != null
      ? `Open People → ${namedPeople[0].displayName}`
      : waitingItems.length > 0
        ? "Open People → Waiting on"
        : null;

  // AI synthesis when available.
  if (!degraded) {
    try {
      const ai = await aiService.answerQuery({
        question,
        today,
        records: contextRecords,
        finance: financeNeedsSync ? null : finance,
        conversation,
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
        suggestedNextAction: ai.suggestedNextAction ?? defaultNext,
        promptVersion: QUERY_ANSWER_PROMPT_VERSION,
        degraded: ai.degraded,
      });
    } catch {
      // Fall through to rule-based answer.
    }
  }

  // Deterministic fallback.
  let answer: string;
  let confidence =
    relevant.length > 0 || waitingItems.length > 0 || (finance && !financeNeedsSync)
      ? 0.6
      : 0.3;
  let caveats: string | null =
    relevant.length === 0 && waitingItems.length === 0 && !finance
      ? "Limited matching records found."
      : null;
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
  } else if (personIntent && (relevant.length > 0 || waitingItems.length > 0)) {
    const who = namedPeople[0]?.displayName ?? "them";
    const bits: string[] = [];
    if (relevant.length > 0) {
      bits.push(
        `Found ${relevant.length} related record(s). Top: "${relevant[0]!.title}".`,
      );
    }
    if (waitingItems.length > 0) {
      bits.push(
        `Waiting on ${waitingItems.length} follow-up${waitingItems.length === 1 ? "" : "s"} from ${who}.`,
      );
    }
    answer = bits.join(" ");
    confidence = 0.8;
    suggestedNextAction = defaultNext;
  } else if (waitingOnly) {
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
