import { listTasksForUser } from "./tasks";
import type { EvidenceDto } from "./evidence";
import { aiService, type QueryFinanceAggregate } from "./ai";
import {
  FINANCE_INTENT,
  FINANCE_BREAKDOWN_INTENT,
  FAMILY_RELATION_INTENT,
  PERSON_INTENT,
  WAITING_INTENT,
  financeMetricForQuestion,
  primaryFinanceFigure,
  todayIso,
} from "./query-utils";
import { loadSyncedFinanceAggregate } from "./finance-sync";
import { ensureUserFinanceFresh } from "./finance-auto-sync";
import {
  buildGmailSearchQuery,
  liveSearchGmailForUser,
} from "./connectors";
import { retrieveRelevantRecords } from "./retrieval";
import { extractMailboxHint } from "./retrieval";
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

function buildFinanceBreakdownAnswer(
  finance: QueryFinanceAggregate,
  metric: "spent" | "income" | "net",
): string {
  const primary = primaryFinanceFigure(finance, metric);
  const lines = finance.transactions
    .filter((t) => {
      if (metric === "spent") return t.amount < 0;
      if (metric === "income") return t.amount > 0;
      return true;
    })
    .map(
      (t) =>
        `• ${t.date} — ${t.payee} — ${t.amountFormatted}${
          t.category ? ` (${t.category})` : ""
        }`,
    );
  const head =
    metric === "spent"
      ? `You spent ${primary.formatted} across ${lines.length} transaction(s)`
      : metric === "income"
        ? `Your income was ${primary.formatted} across ${lines.length} transaction(s)`
        : `Net total is ${primary.formatted} across ${lines.length} transaction(s)`;
  const range = finance.rangeLabel ? ` for ${finance.rangeLabel}` : "";
  if (lines.length === 0) {
    return `${head}${range}. No matching transactions were found.`;
  }
  const truncated =
    finance.count > finance.transactions.length
      ? `\n\n(Showing ${finance.transactions.length} of ${finance.count} matching transactions.)`
      : "";
  return `${head}${range}:\n\n${lines.join("\n")}${truncated}`;
}

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
  // Family facts must not be poisoned by earlier wrong assistant answers in the same thread.
  const conversation: ConversationTurn[] = familyIntent
    ? priorTurns.filter((t) => t.role === "user").slice(-3)
    : priorTurns;
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
    retrieveRelevantRecords(
      userId,
      retrievalQuestion,
      familyIntent || /\b(email|emails|gmail|inbox|mail)\b/i.test(retrievalQuestion) ? 16 : 12,
    ),
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

  if (
    FINANCE_INTENT.test(question) ||
    FINANCE_BREAKDOWN_INTENT.test(question) ||
    FINANCE_INTENT.test(retrievalQuestion)
  ) {
    await ensureUserFinanceFresh(userId, { awaitSync: true });
    try {
      const synced = await loadSyncedFinanceAggregate(userId, retrievalQuestion, today);
      if (synced) {
        finance = synced.finance;
        financeNeedsSync = synced.needsSync;
        const metric = financeMetricForQuestion(retrievalQuestion);
        const primary = primaryFinanceFigure(finance, metric);
        const wantsBreakdown = FINANCE_BREAKDOWN_INTENT.test(question);
        evidence.push(
          makeEvidence({
            claimType: "amount_calculated_from",
            evidenceText: synced.needsSync
              ? "Finance connector is configured but no transactions are synced yet. Sync on Connectors first."
              : `Primary (${primary.label}): ${primary.formatted}. Spent ${finance.formatted.spent} (${finance.expenseCount} expenses), income ${finance.formatted.income} (${finance.incomeCount} credits), net ${finance.formatted.net} across ${finance.count} transaction(s)${
                  finance.rangeLabel ? ` for ${finance.rangeLabel}` : ""
                }. Source: synced MyFamilyBudget records in Recall.`,
            metadata: {
              rangeLabel: finance.rangeLabel,
              metric,
              spent: finance.spent,
              income: finance.income,
              net: finance.total,
              formatted: finance.formatted,
              topPayees: finance.formatted.topPayees.slice(0, 5),
              topCategories: finance.formatted.topCategories.slice(0, 5),
              transactionCount: finance.transactions.length,
              wantsBreakdown,
              connectorId: synced.connectorId,
              payeeFilter: synced.payeeFilter,
              needsSync: synced.needsSync,
              source: "synced_source_records",
            },
          }),
        );
        if (wantsBreakdown) {
          for (const t of finance.transactions.slice(0, 80)) {
            evidence.push(
              makeEvidence({
                claimType: "amount_calculated_from",
                evidenceText: `${t.date} | ${t.payee} | ${t.amountFormatted}${
                  t.category ? ` | ${t.category}` : ""
                }`,
                metadata: {
                  relatedEntityType: "finance_transaction",
                  payee: t.payee,
                  date: t.date,
                  amount: t.amount,
                },
              }),
            );
          }
        }
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

  // Live Gmail API search across every connected mailbox when Ask names a sender/topic.
  // Synced cache is only recent mail — this finds people like "Nancy Bryant" who aren't in the cache.
  const liveMailContext: {
    entityType: string;
    entityId: string;
    title: string;
    text: string;
  }[] = [];
  const wantsEmailAsk =
    /\b(email|emails|e-mails?|gmail|inbox|mail|message|messages)\b/i.test(question) ||
    /\b(email|emails|e-mails?|gmail|inbox|mail|message|messages)\b/i.test(retrievalQuestion);
  const gmailQuery =
    buildGmailSearchQuery(question) ?? buildGmailSearchQuery(retrievalQuestion);
  if (wantsEmailAsk && gmailQuery) {
    try {
      const liveHits = await liveSearchGmailForUser(userId, gmailQuery, {
        mailboxHint: extractMailboxHint(question, [
          "ehernandez2@gmail.com",
          "reiinvestorsllc@gmail.com",
          "discoveryunlocked@gmail.com",
        ]),
        maxPerMailbox: 12,
      });
      for (const hit of liveHits.slice(0, 24)) {
        liveMailContext.push({
          entityType: "source_record",
          entityId: hit.externalId,
          title: `[${hit.mailbox}] ${hit.title}`,
          text: `email gmail inbox mail message source=gmail_message mailbox=${hit.mailbox}\n${hit.text}`,
        });
        evidence.push(
          makeEvidence({
            claimType: "source_excerpt",
            evidenceText: `[${hit.mailbox}] ${hit.title}\n${hit.text.slice(0, 450)}`,
            metadata: {
              relatedEntityType: "gmail_message",
              mailbox: hit.mailbox,
              retrievalMethod: "live_gmail_search",
              gmailQuery,
              sourceUrl: hit.sourceUrl,
            },
          }),
        );
      }
      if (liveHits.length === 0) {
        evidence.push(
          makeEvidence({
            claimType: "summary_based_on",
            evidenceText: `Live Gmail search for "${gmailQuery}" returned no messages across your connected Google accounts (including ehernandez2@gmail.com and reiinvestorsllc@gmail.com).`,
            metadata: {
              retrievalMethod: "live_gmail_search",
              gmailQuery,
              hitCount: 0,
            },
          }),
        );
      }
    } catch {
      // Live search unavailable — fall back to synced corpus only.
    }
  }

  const contextRecords = waitingOnly
    ? waitingContext
    : [...liveMailContext, ...waitingContext, ...retrievalContext].slice(
        0,
        liveMailContext.length > 0 ? 22 : familyIntent ? 16 : 14,
      );

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

  // Full transaction lists are deterministic — don't let the model truncate them.
  if (finance && !financeNeedsSync && FINANCE_BREAKDOWN_INTENT.test(question)) {
    return finish({
      answer: buildFinanceBreakdownAnswer(
        finance,
        financeMetricForQuestion(retrievalQuestion),
      ),
      confidence: 0.95,
      caveats:
        finance.count > finance.transactions.length
          ? `Listed ${finance.transactions.length} of ${finance.count} matching transactions.`
          : null,
      evidence,
      relatedRecords,
      suggestedNextAction: "Open Connectors → Finance",
      promptVersion: QUERY_ANSWER_PROMPT_VERSION,
      degraded: false,
    });
  }

  // AI synthesis when available.
  if (!degraded) {
    try {
      const metric = finance && !financeNeedsSync ? financeMetricForQuestion(question) : null;
      const ai = await aiService.answerQuery({
        question,
        today,
        records: contextRecords,
        finance: financeNeedsSync
          ? null
          : finance
            ? {
                ...finance,
                // Hint which figure to lead with (spent vs income vs net).
                rangeLabel:
                  metric && finance.rangeLabel
                    ? `${finance.rangeLabel} · answer with ${metric}`
                    : metric
                      ? `answer with ${metric}`
                      : finance.rangeLabel,
              }
            : null,
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
    const metric = financeMetricForQuestion(retrievalQuestion);
    if (FINANCE_BREAKDOWN_INTENT.test(question)) {
      answer = buildFinanceBreakdownAnswer(finance, metric);
      confidence = 0.95;
      suggestedNextAction = "Open Connectors → Finance";
    } else {
      const primary = primaryFinanceFigure(finance, metric);
      const topPayee = finance.formatted.topPayees[0];
      if (metric === "spent") {
        answer =
          `You spent ${primary.formatted} across ${finance.expenseCount} expense(s)` +
          `${finance.rangeLabel ? ` for ${finance.rangeLabel}` : ""}.` +
          (topPayee ? ` Largest: ${topPayee.payee} (${topPayee.total}).` : "") +
          ` Ask for a breakdown to see every transaction.`;
      } else if (metric === "income") {
        answer =
          `Your income was ${primary.formatted} across ${finance.incomeCount} credit(s)` +
          `${finance.rangeLabel ? ` for ${finance.rangeLabel}` : ""}.` +
          (topPayee ? ` Largest: ${topPayee.payee} (${topPayee.total}).` : "");
      } else {
        answer =
          `Net total is ${primary.formatted} across ${finance.count} transaction(s)` +
          `${finance.rangeLabel ? ` for ${finance.rangeLabel}` : ""}` +
          ` (spent ${finance.formatted.spent}, income ${finance.formatted.income}).` +
          (topPayee ? ` Largest: ${topPayee.payee} (${topPayee.total}).` : "");
      }
      confidence = 0.85;
      suggestedNextAction = "Ask for a breakdown to see every transaction";
    }
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
