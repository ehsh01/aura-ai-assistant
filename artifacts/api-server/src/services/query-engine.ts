import type { EvidenceDto } from "./evidence";
import { aiService, type QueryFinanceAggregate } from "./ai";
import {
  FINANCE_INTENT,
  FINANCE_BREAKDOWN_INTENT,
  FAMILY_RELATION_INTENT,
  NOTE_CAPABILITY_INTENT,
  PERSON_INTENT,
  WAITING_INTENT,
  financeMetricForQuestion,
  formatInstantForUser,
  nowLocalLabel,
  primaryFinanceFigure,
  todayIso,
} from "./query-utils";
import { loadSyncedFinanceAggregate } from "./finance-sync";
import { ensureUserFinanceFresh } from "./finance-auto-sync";
import {
  getConnectedGoogleMailboxes,
  liveSearchDriveForUser,
  liveSearchGmailForUser,
  listConnectorsForUser,
} from "./connectors";
import {
  backfillGmailPlanWithNamedPerson,
  isEmailSearchIntent,
  planGmailSearch,
} from "./nl-gmail-query";
import { isDriveSearchIntent, planDriveSearch } from "./nl-drive-query";
import { isHomeyAskIntent, planHomeyAsk } from "./nl-homey-query";
import { extractMailboxHint, retrieveRelevantRecords } from "./retrieval";
import { promptTextForRetrievedRecord } from "./prompt-context";
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
import { buildAskAnswerMetadata } from "./ask-answer-metadata";
import {
  annotatePrimaryExternalLink,
  compactSuggestedNextAction,
} from "./ask-compact-ui";
import {
  noteIdsForAskImages,
  wantsShowSavedImage,
  type AskAnswerImage,
} from "./ask-images";
import { listImageAttachmentsForNotes } from "./note-attachments";
import { executeHomeyAskForUser } from "./connectors";
import { listOpenHomeyAlertsForUser } from "./homey-alerts";
import { formatUserRulesForPrompt } from "./user-rules";
import { listRecentAskFeedbackHints } from "./ask-feedback";
import { logger } from "../lib/logger";
import { detectAskAmbiguity } from "./ask-ambiguity";
import { routeSourcePlan } from "./source-router";
import {
  confidenceFromSources,
  type SourceConsulted,
} from "./ask-accuracy-policy";
import { verifyFinanceAmountsInAnswer } from "./ask-verifier";
import { isRelationLiteral } from "./ask-accuracy-policy";

function buildFinanceBreakdownAnswer(
  finance: QueryFinanceAggregate,
  metric: "spent" | "income" | "net",
): string {
  const primary = primaryFinanceFigure(finance, metric);
  const lines = finance.transactions
    .filter((t) => {
      if (metric === "spent") {
        if (t.kind) return t.kind === "expense";
        return t.amount < 0;
      }
      if (metric === "income") {
        if (t.kind) return t.kind === "income";
        return t.amount > 0;
      }
      // Net breakdown: omit transfers / CC payments when classified.
      if (t.kind) {
        return t.kind === "expense" || t.kind === "income" || t.kind === "refund";
      }
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

/** Deterministic spend/income/net sentence — no LLM paraphrase of the number. */
function buildFinanceTotalAnswer(
  finance: QueryFinanceAggregate,
  metric: "spent" | "income" | "net",
): string {
  const primary = primaryFinanceFigure(finance, metric);
  const range = finance.rangeLabel ? ` for ${finance.rangeLabel}` : "";
  const top = finance.formatted.topPayees[0];
  if (metric === "spent") {
    if (finance.expenseCount === 0) {
      return `No matching expenses were found${range}.`;
    }
    return (
      `You spent ${primary.formatted} across ${finance.expenseCount} expense(s)${range}.` +
      (top ? ` Largest: ${top.payee} (${top.total}).` : "")
    );
  }
  if (metric === "income") {
    if (finance.incomeCount === 0) {
      return `No matching income was found${range}.`;
    }
    return (
      `Your income was ${primary.formatted} across ${finance.incomeCount} credit(s)${range}.` +
      (top ? ` Largest: ${top.payee} (${top.total}).` : "")
    );
  }
  return (
    `Net total is ${primary.formatted} across ${finance.count} transaction(s)${range}` +
    ` (spent ${finance.formatted.spent}, income ${finance.formatted.income}).` +
    (top ? ` Largest: ${top.payee} (${top.total}).` : "")
  );
}

export type QueryAnswer = {
  answer: string;
  confidence: number;
  caveats: string | null;
  evidence: EvidenceDto[];
  relatedRecords: { entityType: string; entityId: string; title: string }[];
  /** Saved note images to render inline when the user asked to see a picture. */
  images: AskAnswerImage[];
  suggestedNextAction: string | null;
  promptVersion: string;
  degraded: boolean;
  threadId: string | null;
  /** Persisted assistant message id for feedback. */
  assistantMessageId?: string | null;
  /** Which systems were consulted for this answer (trust UI). */
  sourcesConsulted?: SourceConsulted[];
  /** Compact UI: short answer + primary link, no evidence dump. */
  presentation?: "full" | "compact";
  privacy: {
    model: string | null;
    dataLeftDevice: boolean;
    categoriesSent: string[];
  };
};

/** Metadata emitted once, before answer tokens, so the UI can show sources instantly. */
export type QueryStreamMeta = {
  threadId: string;
  evidence: EvidenceDto[];
  relatedRecords: { entityType: string; entityId: string; title: string }[];
  images: AskAnswerImage[];
  privacy: QueryAnswer["privacy"];
  sourcesConsulted?: SourceConsulted[];
};

/** Streaming callbacks for the SSE Ask endpoint. */
export type QueryStreamHandlers = {
  onMeta: (meta: QueryStreamMeta) => void;
  onToken: (delta: string) => void;
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

/** Short body preview for last-email answers (subject is shown separately). */
function emailAboutSnippet(text: string): string | null {
  const lines = text.split("\n");
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^Subject:\s*/i.test(lines[i] ?? "")) {
      bodyStart = i + 1;
      break;
    }
  }
  let body = lines
    .slice(bodyStart)
    .join("\n")
    .replace(/\r/g, "")
    .replace(/^Mailbox:\s*.+$/im, "")
    .replace(/^Email message\s*$/im, "")
    .replace(/^From:\s*.+$/im, "")
    .replace(/^To:\s*.+$/im, "")
    .replace(/^sender_name:\s*.+$/im, "")
    .replace(/^sender_email:\s*.+$/im, "")
    .replace(/Sent from Yahoo Mail[^\n]*/gi, "")
    .replace(/On .+? wrote:\s*/gis, " ")
    .replace(/_{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!body) return null;
  if (body.length > 140) body = `${body.slice(0, 137).trim()}…`;
  return body;
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
  options?: { threadId?: string | null; stream?: QueryStreamHandlers | null },
): Promise<QueryAnswer> {
  const today = todayIso();
  const nowLabel = nowLocalLabel();
  const status = aiService.getStatus();
  const degraded = status.degraded;
  const stream = options?.stream ?? null;
  let streamMetaEmitted = false;
  const sourcesConsulted: SourceConsulted[] = [];

  const ambiguity = detectAskAmbiguity(question);
  const workingQuestion = ambiguity.needsClarify
    ? question
    : ambiguity.normalizedQuestion;
  const sourcePlan = routeSourcePlan(workingQuestion);

  const waitingIntent = WAITING_INTENT.test(workingQuestion);
  const personIntent = PERSON_INTENT.test(workingQuestion);
  const familyIntent = FAMILY_RELATION_INTENT.test(workingQuestion);

  const thread = await ensureAskThreadForUser(userId, options?.threadId, question);
  const priorTurns = await listRecentTurnsForThread(userId, thread.id);
  // Family facts must not be poisoned by earlier wrong assistant answers in the same thread.
  const conversation: ConversationTurn[] = familyIntent
    ? priorTurns.filter((t) => t.role === "user").slice(-3)
    : priorTurns;
  const retrievalQuestion = retrievalQueryFromHistory(
    workingQuestion,
    conversation,
  );

  await appendAskMessage({
    userId,
    threadId: thread.id,
    role: "user",
    content: question,
  });

  // Shared finish helper is declared later; for clarify we need a local early path.
  if (ambiguity.needsClarify) {
    const clarifyAnswer: QueryAnswer = {
      answer: ambiguity.question,
      confidence: 0.7,
      caveats: "Clarifying before searching so I don't guess the wrong date or filter.",
      evidence: [],
      relatedRecords: [],
      images: [],
      suggestedNextAction: compactSuggestedNextAction(
        ambiguity.suggestions[0] ? `Reply “${ambiguity.suggestions[0]}”` : null,
      ),
      promptVersion: QUERY_ANSWER_PROMPT_VERSION,
      degraded: false,
      threadId: thread.id,
      sourcesConsulted: [],
      presentation: "compact",
      privacy: {
        model: null,
        dataLeftDevice: true,
        categoriesSent: [],
      },
    };
    const assistantMsg = await appendAskMessage({
      userId,
      threadId: thread.id,
      role: "assistant",
      content: clarifyAnswer.answer,
      metadata: buildAskAnswerMetadata(clarifyAnswer),
    });
    clarifyAnswer.assistantMessageId = assistantMsg.id;
    if (stream) {
      stream.onMeta({
        threadId: thread.id,
        evidence: [],
        relatedRecords: [],
        images: [],
        privacy: clarifyAnswer.privacy,
        sourcesConsulted: [],
      });
      stream.onToken(clarifyAnswer.answer);
    }
    return clarifyAnswer;
  }

  // retrieveRelevantRecords already loads the task list while building the corpus,
  // so reuse it here instead of issuing a duplicate listTasksForUser query.
  const [
    { records: relevantRaw, usedSemantic, namedPeople, tasks },
    waitingRaw,
  ] = await Promise.all([
    retrieveRelevantRecords(
      userId,
      retrievalQuestion,
      familyIntent || /\b(email|emails|gmail|inbox|mail)\b/i.test(retrievalQuestion) ? 16 : 12,
      // FTS uses only the current turn so prior thread context (emails, etc.)
      // doesn't AND-pollute the notes query.
      { noteSearchQuery: workingQuestion },
    ),
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
  let financeConnectorMissing = false;
  let financePayeeDistrusted = false;
  let financeSyncTimedOut = false;
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

  const wantsFinance =
    sourcePlan.required.includes("finance") ||
    FINANCE_INTENT.test(workingQuestion) ||
    FINANCE_BREAKDOWN_INTENT.test(workingQuestion) ||
    FINANCE_INTENT.test(retrievalQuestion);

  if (wantsFinance) {
    // Accuracy first, but never block Ask forever on a large MyFamilyBudget sync.
    const financeFresh = await ensureUserFinanceFresh(userId, {
      awaitSync: true,
      maxAgeMs: 5 * 60_000,
      timeoutMs: 8_000,
    });
    financeSyncTimedOut = Boolean(financeFresh.timedOut);
    try {
      const connectors = await listConnectorsForUser(userId);
      const financeConn = connectors.find((c) => c.type === "finance_api" && c.enabled);
      if (!financeConn) {
        financeConnectorMissing = true;
        sourcesConsulted.push({
          id: "finance",
          label: "MyFamilyBudget",
          status: "missing",
          detail: "No finance connector enabled",
        });
      } else {
        let synced = await loadSyncedFinanceAggregate(
          userId,
          // Use the current question only — history concatenation can inject an
          // older "yesterday" and steal the date from "day before yesterday".
          workingQuestion,
          today,
        );
        // Empty-filter distrust: a payee filter that zeros everything out is
        // usually a bad extract — re-run without payee before reporting $0.
        if (
          synced &&
          !synced.needsSync &&
          synced.payeeFilter &&
          synced.finance.count === 0
        ) {
          const unfiltered = await loadSyncedFinanceAggregate(
            userId,
            workingQuestion,
            today,
            { skipPayeeHint: true },
          );
          if (unfiltered && unfiltered.finance.count > 0) {
            financePayeeDistrusted = true;
            synced = unfiltered;
          }
        }
        if (synced) {
          finance = synced.finance;
          financeNeedsSync = synced.needsSync;
          sourcesConsulted.push({
            id: "finance",
            label: "MyFamilyBudget",
            status: synced.needsSync
              ? "empty"
              : financePayeeDistrusted
                ? "ok"
                : "ok",
            detail: synced.needsSync
              ? "Connected but no transactions synced yet"
              : financePayeeDistrusted
                ? `Ignored suspicious payee filter “${synced.payeeFilter ?? "?"}”; showing unfiltered totals`
                : `Synced · ${synced.finance.count} transaction(s)`,
            hitCount: synced.finance.count,
          });
          const metric = financeMetricForQuestion(workingQuestion);
          const primary = primaryFinanceFigure(finance, metric);
          const wantsBreakdown = FINANCE_BREAKDOWN_INTENT.test(workingQuestion);
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
                payeeFilter: financePayeeDistrusted ? null : synced.payeeFilter,
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
      }
    } catch {
      sourcesConsulted.push({
        id: "finance",
        label: "MyFamilyBudget",
        status: "error",
        detail: "Finance sync or load failed",
      });
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

  // When the user asks to see a saved picture, resolve note image attachments
  // so the Ask UI can render them (the model only ever returns text).
  const imageIntent = wantsShowSavedImage(question);
  let askImages: AskAnswerImage[] = [];
  if (imageIntent) {
    const noteIds = noteIdsForAskImages([...retrievalRelated, ...relatedRecords]);
    if (noteIds.length > 0) {
      const titleByNote = new Map(
        [...retrievalRelated, ...relatedRecords]
          .filter((r) => r.entityType === "note")
          .map((r) => [r.entityId, r.title] as const),
      );
      const attachments = await listImageAttachmentsForNotes(userId, noteIds, 6);
      askImages = attachments.map((a) => ({
        attachmentId: a.id,
        noteId: a.noteId,
        noteTitle: titleByNote.get(a.noteId) ?? "Note",
        fileName: a.fileName,
        mimeType: a.mimeType,
      }));
    }
  }

  const waitingContext = waitingItems.map((w) => {
    const bareId = w.id.includes(":") ? w.id.slice(w.id.indexOf(":") + 1) : w.id;
    return {
      entityType: w.sourceType,
      entityId: bareId,
      title: `${w.person}: ${w.item}`,
      text: `${w.followUp}. ${w.evidenceText}${w.days ? ` (${w.days}d)` : ""}`,
    };
  });
  const wantsEmailAsk =
    sourcePlan.required.includes("gmail") ||
    isEmailSearchIntent(workingQuestion) ||
    isEmailSearchIntent(retrievalQuestion);
  const wantsDriveAsk =
    sourcePlan.required.includes("drive") ||
    isDriveSearchIntent(workingQuestion) ||
    isDriveSearchIntent(retrievalQuestion);

  const retrievalContext = relevant.map((r, rankIndex) => {
    const date = formatInstantForUser(r.updatedAt);
    const body = promptTextForRetrievedRecord(r, {
      question: workingQuestion,
      rankIndex,
      emailIntent: wantsEmailAsk,
      forceExpand: r.method === "keyword" && r.entityType === "note",
    });
    return {
      entityType: r.entityType,
      entityId: r.entityId,
      title: r.title,
      date,
      pinned: r.pinned,
      // Prefer an explicit Date line at the front so answerQuery truncation cannot drop it.
      text:
        date && !/\bDate[=:]/.test(body.slice(0, 180))
          ? `Date: ${date}\n${body}`
          : body,
    };
  });

  // Natural-language live search across every connected Google account.
  // Gmail: "find Nancy's Apr 23 permit email"; Drive: "find the contract PDF".
  // Both use Google's own indexes (Gmail full body, Drive full-text + OCR),
  // run in parallel, so there are no size/scannability limits.
  const liveMailContext: {
    entityType: string;
    entityId: string;
    title: string;
    text: string;
    date?: string | null;
    pinned?: boolean;
  }[] = [];
  let liveGmailHitCount = 0;
  let liveDriveHitCount = 0;
  let lastGmailQuery: string | null = null;
  let topGmailHit: {
    mailbox: string;
    title: string;
    text: string;
    externalId: string;
    sourceUrl: string | null;
    sourceCreatedAt: string | null;
  } | null = null;

  if (wantsEmailAsk || wantsDriveAsk) {
    const mailboxes = await getConnectedGoogleMailboxes(userId);
    const mailboxHint = extractMailboxHint(workingQuestion, mailboxes);
    const accountsLabel =
      mailboxes.length > 0 ? mailboxes.join(", ") : "your connected Google accounts";

    if (wantsEmailAsk && mailboxes.length === 0) {
      sourcesConsulted.push({
        id: "gmail",
        label: "Gmail",
        status: "missing",
        detail: "No Google account connected",
      });
    }

    const [gmailPlanRaw, drivePlan] = await Promise.all([
      wantsEmailAsk && mailboxes.length > 0
        ? planGmailSearch(retrievalQuestion).then((p) =>
            p ??
            (retrievalQuestion.trim() !== workingQuestion.trim()
              ? planGmailSearch(workingQuestion)
              : null),
          )
        : Promise.resolve(null),
      wantsDriveAsk && mailboxes.length > 0
        ? planDriveSearch(retrievalQuestion).then((p) =>
            p ??
            (retrievalQuestion.trim() !== workingQuestion.trim()
              ? planDriveSearch(workingQuestion)
              : null),
          )
        : Promise.resolve(null),
    ]);

    const gmailPlan = wantsEmailAsk
      ? backfillGmailPlanWithNamedPerson(
          gmailPlanRaw,
          namedPeople[0],
          retrievalQuestion,
          workingQuestion,
        )
      : gmailPlanRaw;

    // If planner still has a relation literal and we have no named person, refuse later.
    if (
      gmailPlan?.personName &&
      isRelationLiteral(gmailPlan.personName) &&
      !namedPeople[0]
    ) {
      sourcesConsulted.push({
        id: "gmail",
        label: "Gmail",
        status: "error",
        detail: `Could not resolve “${gmailPlan.personName}” to a person in People`,
      });
    }

    const emailOnlyLatest =
      sourcePlan.answerMode === "deterministic_email";
    const [gmailHits, driveHits] = await Promise.all([
      gmailPlan?.query && !isRelationLiteral(gmailPlan.personName)
        ? liveSearchGmailForUser(userId, gmailPlan.query, {
            mailboxHint,
            maxPerMailbox: emailOnlyLatest ? 8 : 15,
            personName: gmailPlan.personName,
          }).catch(() => [])
        : Promise.resolve([]),
      drivePlan?.query
        ? liveSearchDriveForUser(userId, drivePlan.query, {
            mailboxHint,
            maxPerAccount: 15,
          }).catch(() => [])
        : Promise.resolve([]),
    ]);

    liveGmailHitCount = gmailHits.length;
    liveDriveHitCount = driveHits.length;
    lastGmailQuery = gmailPlan?.query ?? null;
    if (gmailHits[0]) {
      topGmailHit = {
        mailbox: gmailHits[0].mailbox,
        title: gmailHits[0].title,
        text: gmailHits[0].text,
        externalId: gmailHits[0].externalId,
        sourceUrl: gmailHits[0].sourceUrl,
        sourceCreatedAt: gmailHits[0].sourceCreatedAt,
      };
    }

    if (gmailPlan?.query) {
      sourcesConsulted.push({
        id: "gmail",
        label: "Gmail",
        status: gmailHits.length > 0 ? "ok" : "empty",
        detail:
          gmailHits.length > 0
            ? emailOnlyLatest
              ? `Latest match · ${accountsLabel}`
              : `${gmailHits.length} message(s) · ${accountsLabel}`
            : `No messages for “${gmailPlan.query}” across ${accountsLabel}`,
        hitCount: emailOnlyLatest && gmailHits.length > 0 ? 1 : gmailHits.length,
      });
      // Last-email answers only need the top hit; skip stuffing the UI with the thread.
      const hitsForContext = emailOnlyLatest
        ? gmailHits.slice(0, 1)
        : gmailHits.slice(0, 24);
      for (const hit of hitsForContext) {
        const date = formatInstantForUser(hit.sourceCreatedAt);
        liveMailContext.push({
          entityType: "source_record",
          entityId: hit.externalId,
          title: date
            ? `[${hit.mailbox}] ${hit.title} · ${date}`
            : `[${hit.mailbox}] ${hit.title}`,
          date,
          text: `email gmail inbox mail message source=gmail_message mailbox=${hit.mailbox}${
            date ? `\nDate: ${date}` : ""
          }\n${hit.text}`,
        });
        if (!emailOnlyLatest) {
          evidence.push(
            makeEvidence({
              claimType: "source_excerpt",
              evidenceText: `[${hit.mailbox}] ${hit.title}${date ? ` (${date})` : ""}\n${hit.text.slice(0, 450)}`,
              metadata: {
                relatedEntityType: "gmail_message",
                mailbox: hit.mailbox,
                retrievalMethod: "live_gmail_search",
                gmailQuery: gmailPlan.query,
                querySource: gmailPlan.source,
                sourceUrl: hit.sourceUrl,
                sourceCreatedAt: hit.sourceCreatedAt,
                sourceCreatedAtLocal: date,
              },
            }),
          );
        }
      }
      if (gmailHits.length === 0 && !emailOnlyLatest) {
        evidence.push(
          makeEvidence({
            claimType: "summary_based_on",
            evidenceText: `Live Gmail search for "${gmailPlan.query}" returned no messages across ${accountsLabel}.`,
            metadata: {
              retrievalMethod: "live_gmail_search",
              gmailQuery: gmailPlan.query,
              querySource: gmailPlan.source,
              hitCount: 0,
            },
          }),
        );
      }
    }

    if (drivePlan?.query) {
      sourcesConsulted.push({
        id: "drive",
        label: "Google Drive",
        status: driveHits.length > 0 ? "ok" : "empty",
        detail:
          driveHits.length > 0
            ? `${driveHits.length} file(s)`
            : `No files for “${drivePlan.query}”`,
        hitCount: driveHits.length,
      });
      for (const hit of driveHits.slice(0, 24)) {
        const date = formatInstantForUser(hit.sourceCreatedAt);
        liveMailContext.push({
          entityType: "source_record",
          entityId: hit.externalId,
          title: date
            ? `[${hit.account}] ${hit.title} · ${date}`
            : `[${hit.account}] ${hit.title}`,
          date,
          text: `drive file document google drive pdf attachment source=drive_file account=${hit.account}${
            hit.mimeType ? ` type=${hit.mimeType}` : ""
          }${date ? `\nModified: ${date}` : ""}${
            hit.sourceUrl ? `\nLink: ${hit.sourceUrl}` : ""
          }\n${hit.text}`,
        });
        evidence.push(
          makeEvidence({
            claimType: "source_excerpt",
            evidenceText: `[${hit.account}] ${hit.title}${date ? ` (${date})` : ""}\n${hit.text.slice(0, 450)}`,
            metadata: {
              relatedEntityType: "drive_file",
              account: hit.account,
              mimeType: hit.mimeType,
              retrievalMethod: "live_drive_search",
              driveQuery: drivePlan.query,
              querySource: drivePlan.source,
              sourceUrl: hit.sourceUrl,
              sourceCreatedAt: hit.sourceCreatedAt,
              sourceCreatedAtLocal: date,
            },
          }),
        );
      }
      if (driveHits.length === 0) {
        evidence.push(
          makeEvidence({
            claimType: "summary_based_on",
            evidenceText: `Live Google Drive search for "${drivePlan.query}" returned no files across ${accountsLabel}.`,
            metadata: {
              retrievalMethod: "live_drive_search",
              driveQuery: drivePlan.query,
              querySource: drivePlan.source,
              hitCount: 0,
            },
          }),
        );
      }
    }
  }

  const contextRecords = waitingOnly
    ? waitingContext
    : [...liveMailContext, ...waitingContext, ...retrievalContext].slice(
        0,
        liveMailContext.length > 0 ? 26 : familyIntent ? 16 : 14,
      );

  if (askImages.length > 0) {
    contextRecords.unshift({
      entityType: "note",
      entityId: askImages[0]!.noteId,
      title: "Saved images available in the UI",
      text:
        `The user asked to see a saved image. The app WILL display ${askImages.length} image(s) ` +
        `below your reply (${askImages.map((i) => i.fileName).join(", ")}). ` +
        `Answer briefly: name the note and what the image is. Do not say you cannot show images.`,
      pinned: true,
    });
  }

  const finish = async (
    result: Omit<QueryAnswer, "privacy" | "threadId" | "images"> & {
      privacy?: QueryAnswer["privacy"];
      threadId?: string | null;
      images?: AskAnswerImage[];
    },
    streamOpts?: { streamed?: boolean },
  ): Promise<QueryAnswer> => {
    const categoriesSent = [
      ...new Set(
        [
          ...result.relatedRecords.map((r) => r.entityType),
          ...relevant.map((r) => r.entityType),
        ].filter(Boolean),
      ),
    ];
    const images = result.images ?? askImages;
    let answer = result.answer;
    if (
      imageIntent &&
      images.length > 0 &&
      !/\b(here('s| is)|showing|below)\b/i.test(answer.slice(0, 120))
    ) {
      const from = [...new Set(images.map((i) => i.noteTitle))].slice(0, 2).join("; ");
      answer = `Here's the saved image from “${from}”:\n\n${answer}`;
    }
    const withPrivacy: QueryAnswer = {
      ...result,
      answer,
      images,
      threadId: thread.id,
      evidence: annotatePrimaryExternalLink(result.evidence),
      suggestedNextAction: compactSuggestedNextAction(result.suggestedNextAction, {
        answer,
        confidence: result.confidence,
        caveats: result.caveats,
      }),
      presentation: result.presentation ?? "compact",
      sourcesConsulted: result.sourcesConsulted ?? sourcesConsulted,
      privacy: result.privacy ?? {
        model: status.model,
        dataLeftDevice: !result.degraded && Boolean(status.enabled),
        categoriesSent,
      },
    };

    // Streaming: emit sources once, then the answer text. When the LLM path
    // already streamed tokens (streamed: true), only emit meta if not sent yet.
    if (stream) {
      if (!streamMetaEmitted) {
        streamMetaEmitted = true;
        stream.onMeta({
          threadId: withPrivacy.threadId ?? thread.id,
          evidence: withPrivacy.evidence,
          relatedRecords: withPrivacy.relatedRecords,
          images: withPrivacy.images,
          privacy: withPrivacy.privacy,
          sourcesConsulted: withPrivacy.sourcesConsulted,
        });
      }
      if (!streamOpts?.streamed) {
        stream.onToken(withPrivacy.answer);
      }
    }

    const assistantMsg = await appendAskMessage({
      userId,
      threadId: thread.id,
      role: "assistant",
      content: withPrivacy.answer,
      metadata: buildAskAnswerMetadata(withPrivacy),
    });
    withPrivacy.assistantMessageId = assistantMsg.id;

    await writeAuditLog({
      userId,
      action: "query_answered",
      entityType: "query",
      entityId: thread.id,
      metadata: {
        question: question.slice(0, 240),
        threadId: thread.id,
        assistantMessageId: assistantMsg.id,
        confidence: withPrivacy.confidence,
        evidenceCount: withPrivacy.evidence.length,
        imageCount: withPrivacy.images.length,
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

  const wantsHomeyAlerts =
    /\b(homey|smart\s*home|home)\b/i.test(question) &&
    /\b(alert|alerts|emergency|emergencies|leak|smoke|door\s+open|alarm)\b/i.test(
      question,
    );
  if (wantsHomeyAlerts) {
    const openAlerts = await listOpenHomeyAlertsForUser(userId, { limit: 6, hours: 48 });
    if (openAlerts.length === 0) {
      return finish({
        answer:
          "There are no open Homey alerts in Recall right now. Homey Flows can POST important events to the Connectors webhook.",
        confidence: 0.85,
        caveats: null,
        evidence: [],
        relatedRecords: [],
        suggestedNextAction: "Open Connectors → Homey",
        promptVersion: QUERY_ANSWER_PROMPT_VERSION,
        degraded: false,
      });
    }
    const lines = openAlerts.map((a) => {
      const when = a.createdAt ? ` (${a.createdAt})` : "";
      const device = a.deviceName ? ` · ${a.deviceName}` : "";
      return `- [${a.severity}] ${a.title}${device}${when}`;
    });
    return finish({
      answer: `Open Homey alerts:\n${lines.join("\n")}`,
      confidence: 0.9,
      caveats: null,
      evidence: openAlerts.slice(0, 3).map((a) =>
        makeEvidence({
          claimType: "summary_based_on",
          evidenceText: `${a.severity}: ${a.title}`,
          metadata: { retrievalMethod: "homey_alert", alertId: a.id },
        }),
      ),
      relatedRecords: [],
      suggestedNextAction: "Acknowledge on Connectors or Ask to control a device",
      promptVersion: QUERY_ANSWER_PROMPT_VERSION,
      degraded: false,
    });
  }

  const homeyPlan = planHomeyAsk(question);
  if (homeyPlan && isHomeyAskIntent(question)) {
    const result = await executeHomeyAskForUser(userId, homeyPlan);
    const homeyEvidence: EvidenceDto[] = [];
    if (result.evidenceText) {
      homeyEvidence.push(
        makeEvidence({
          claimType: "summary_based_on",
          evidenceText: result.evidenceText,
          metadata: {
            retrievalMethod: "live_homey",
            needsConfirmation: result.needsConfirmation ?? false,
          },
        }),
      );
    }
    return finish({
      answer: result.answer,
      confidence: result.ok ? (result.needsConfirmation ? 0.7 : 0.9) : 0.4,
      caveats: result.needsConfirmation
        ? "Confirm before Homey applies this change."
        : result.ok
          ? null
          : "Connect or sync Homey in Connectors if this looks wrong.",
      evidence: homeyEvidence,
      relatedRecords: [],
      suggestedNextAction: result.needsConfirmation
        ? "Reply “confirm” to apply"
        : "Ask about another device",
      promptVersion: QUERY_ANSWER_PROMPT_VERSION,
      degraded: false,
    });
  }

  if (NOTE_CAPABILITY_INTENT.test(question)) {
    return finish({
      answer:
        "Yes. I can search note titles, full note text, and text extracted from attached images, PDFs, and documents. Tell me what you want to find—for example, “What is the VIN in my Porsche notes?”",
      confidence: 1,
      caveats: null,
      evidence: [],
      relatedRecords: [],
      suggestedNextAction: "Ask what you want to find in your notes",
      promptVersion: QUERY_ANSWER_PROMPT_VERSION,
      degraded: false,
    });
  }

  // Full transaction lists are deterministic — don't let the model truncate them.
  if (finance && !financeNeedsSync && FINANCE_BREAKDOWN_INTENT.test(workingQuestion)) {
    const verdict = confidenceFromSources({
      requiredOk: true,
      requiredEmptyAfterSafeFilter: finance.expenseCount === 0 && finance.incomeCount === 0,
      stale: false,
      connectorMissing: false,
      authError: false,
      hasGrounding: true,
    });
    return finish({
      answer: buildFinanceBreakdownAnswer(
        finance,
        financeMetricForQuestion(retrievalQuestion),
      ),
      confidence: verdict.confidence,
      caveats:
        finance.count > finance.transactions.length
          ? `Listed ${finance.transactions.length} of ${finance.count} matching transactions.`
          : financePayeeDistrusted
            ? "Ignored a suspicious merchant filter that matched nothing."
            : null,
      evidence,
      relatedRecords,
      suggestedNextAction: "Open Connectors → Finance",
      promptVersion: QUERY_ANSWER_PROMPT_VERSION,
      degraded: false,
      sourcesConsulted,
    });
  }

  // Connector health: finance required but missing.
  if (sourcePlan.required.includes("finance") && financeConnectorMissing) {
    return finish({
      answer:
        "I can't answer spending questions until MyFamilyBudget is connected. Open Connectors and connect Finance, then ask again.",
      confidence: 0.35,
      caveats: "Finance connector missing.",
      evidence,
      relatedRecords,
      suggestedNextAction: "Open Connectors → Finance",
      promptVersion: QUERY_ANSWER_PROMPT_VERSION,
      degraded: false,
      sourcesConsulted,
    });
  }

  if (sourcePlan.required.includes("finance") && financeNeedsSync) {
    return finish({
      answer:
        "Your finance connector is set up, but no transactions are synced yet. Open Connectors and sync Finance, then ask again.",
      confidence: 0.4,
      caveats: "No synced finance records.",
      evidence,
      relatedRecords,
      suggestedNextAction: "Open Connectors → Sync Finance",
      promptVersion: QUERY_ANSWER_PROMPT_VERSION,
      degraded: false,
      sourcesConsulted,
    });
  }

  // Deterministic finance totals — LLM must not paraphrase the dollar amount.
  if (
    finance &&
    !financeNeedsSync &&
    (sourcePlan.answerMode === "deterministic_total" ||
      (sourcePlan.required.includes("finance") &&
        !FINANCE_BREAKDOWN_INTENT.test(workingQuestion)))
  ) {
    const metric = financeMetricForQuestion(workingQuestion);
    const verdict = confidenceFromSources({
      requiredOk: true,
      requiredEmptyAfterSafeFilter:
        metric === "spent"
          ? finance.expenseCount === 0
          : metric === "income"
            ? finance.incomeCount === 0
            : finance.count === 0,
      stale: false,
      connectorMissing: false,
      authError: false,
      hasGrounding: true,
    });
    const financeOnlyEvidence = evidence.filter(
      (ev) =>
        ev.claimType === "amount_calculated_from" ||
        ev.evidenceMetadata?.source === "synced_source_records",
    );
    return finish({
      answer: buildFinanceTotalAnswer(finance, metric),
      confidence: verdict.confidence,
      caveats: [
        financePayeeDistrusted
          ? "Ignored a suspicious merchant filter that matched nothing; totals are for the date range only."
          : null,
        financeSyncTimedOut
          ? "Finance refresh was still running — this total is from the last completed sync."
          : null,
      ]
        .filter(Boolean)
        .join(" ") || null,
      evidence: financeOnlyEvidence.slice(0, 1),
      relatedRecords: [],
      suggestedNextAction: null,
      promptVersion: QUERY_ANSWER_PROMPT_VERSION,
      degraded: false,
      sourcesConsulted: sourcesConsulted.filter((s) => s.id === "finance"),
      presentation: "compact",
      privacy: {
        model: null,
        dataLeftDevice: false,
        categoriesSent: ["finance_transaction"],
      },
    });
  }

  // Deterministic last-email answer from top live hit.
  if (sourcePlan.answerMode === "deterministic_email") {
    const compactPrivacy = {
      model: null,
      dataLeftDevice: false,
      categoriesSent: ["gmail_message"],
    };
    if (sourcesConsulted.some((s) => s.id === "gmail" && s.status === "missing")) {
      return finish({
        answer:
          "I can't search email until a Google account is connected. Open Connectors and connect Google, then ask again.",
        confidence: 0.35,
        caveats: "Gmail not connected.",
        evidence: [],
        relatedRecords: [],
        suggestedNextAction: "Open Connectors → Google",
        promptVersion: QUERY_ANSWER_PROMPT_VERSION,
        degraded: false,
        sourcesConsulted,
        presentation: "compact",
        privacy: compactPrivacy,
      });
    }
    if (
      sourcesConsulted.some((s) =>
        s.detail?.includes("Could not resolve"),
      )
    ) {
      const who =
        workingQuestion.match(/\bmy\s+(\w+)/i)?.[1] ?? "that person";
      return finish({
        answer: `I know you're asking about your ${who}, but I couldn't match that to someone in People. Add or update their role (e.g. role=wife), then ask again.`,
        confidence: 0.55,
        caveats: "Person not resolved.",
        evidence: [],
        relatedRecords: [],
        suggestedNextAction: "Open People",
        promptVersion: QUERY_ANSWER_PROMPT_VERSION,
        degraded: false,
        sourcesConsulted,
        presentation: "compact",
        privacy: compactPrivacy,
      });
    }
    if (topGmailHit) {
      const date = formatInstantForUser(topGmailHit.sourceCreatedAt);
      const fromLine =
        topGmailHit.text.match(/^from:\s*(.+)$/im)?.[1]?.trim() ??
        topGmailHit.text.match(/sender_name:\s*(.+)$/im)?.[1]?.trim() ??
        "unknown sender";
      const who = namedPeople[0]?.displayName ?? fromLine;
      const about = emailAboutSnippet(topGmailHit.text);
      const whenLine = date ?? "date unknown";
      const answerLines = [
        `Latest email from ${who}`,
        `When: ${whenLine}`,
        `Subject: ${topGmailHit.title}`,
      ];
      if (about) answerLines.push(`About: ${about}`);
      answerLines.push(`Mailbox: ${topGmailHit.mailbox}`);
      const emailEvidence = [
        makeEvidence({
          claimType: "source_excerpt",
          evidenceText: `${topGmailHit.title}${date ? ` (${date})` : ""}\n${about ?? ""}`.trim(),
          entityType: "gmail_message",
          entityId: topGmailHit.externalId,
          metadata: {
            relatedEntityType: "gmail_message",
            relatedEntityId: topGmailHit.externalId,
            mailbox: topGmailHit.mailbox,
            retrievalMethod: "live_gmail_search",
            sourceUrl: topGmailHit.sourceUrl,
            sourceCreatedAt: topGmailHit.sourceCreatedAt,
            sourceCreatedAtLocal: date,
            primaryLinkLabel: "Open in Gmail",
          },
        }),
      ];
      return finish({
        answer: answerLines.join("\n"),
        confidence: 0.95,
        caveats: null,
        evidence: emailEvidence,
        relatedRecords: [],
        suggestedNextAction: null,
        promptVersion: QUERY_ANSWER_PROMPT_VERSION,
        degraded: false,
        sourcesConsulted: sourcesConsulted.filter((s) => s.id === "gmail"),
        presentation: "compact",
        privacy: compactPrivacy,
      });
    }
    return finish({
      answer: lastGmailQuery
        ? `I searched Gmail for “${lastGmailQuery}” and found no matching messages. If you expected mail from someone, check their People record email/name or try a broader phrasing.`
        : "I couldn't build a Gmail search for that question. Try “last email from [name]”.",
      confidence: 0.9,
      caveats: "Live Gmail search returned no hits.",
      evidence: [],
      relatedRecords: [],
      suggestedNextAction: namedPeople[0]
        ? `Open People → ${namedPeople[0].displayName}`
        : "Open Connectors → Google",
      promptVersion: QUERY_ANSWER_PROMPT_VERSION,
      degraded: false,
      sourcesConsulted: sourcesConsulted.filter((s) => s.id === "gmail"),
      presentation: "compact",
      privacy: compactPrivacy,
    });
  }

  // AI synthesis when available.
  if (!degraded) {
    try {
      const metric = finance && !financeNeedsSync ? financeMetricForQuestion(question) : null;
      const [rulesPrompt, feedbackHints] = await Promise.all([
        formatUserRulesForPrompt(userId),
        listRecentAskFeedbackHints(userId),
      ]);
      const userRulesPrompt = [rulesPrompt, feedbackHints].filter(Boolean).join("\n\n") || null;

      const answerRequest = {
        question,
        today,
        now: nowLabel,
        records: contextRecords,
        finance: financeNeedsSync
          ? null
          : finance
            ? {
                ...finance,
                transactions: finance.transactions.slice(0, 40),
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
        userRulesPrompt,
      };

      logger.debug(
        {
          answer_prompt_chars: JSON.stringify({
            question,
            conversation,
            records: answerRequest.records,
            finance: answerRequest.finance
              ? {
                  ...answerRequest.finance,
                  transactions: answerRequest.finance.transactions,
                }
              : null,
          }).length,
          record_count: contextRecords.length,
        },
        "ask_answer_prompt_metrics",
      );

      // Streaming path: emit sources first, then stream answer tokens. Confidence
      // and caveats are derived from retrieval signals (the model returns plain text).
      if (stream && typeof aiService.answerQueryStream === "function") {
        streamMetaEmitted = true;
        stream.onMeta({
          threadId: thread.id,
          evidence,
          relatedRecords,
          images: askImages,
          privacy: {
            model: status.model,
            dataLeftDevice: Boolean(status.enabled),
            categoriesSent: [
              ...new Set(
                [
                  ...relatedRecords.map((r) => r.entityType),
                  ...relevant.map((r) => r.entityType),
                ].filter(Boolean),
              ),
            ],
          },
        });
        const streamed = await aiService.answerQueryStream(answerRequest, (delta) =>
          stream.onToken(delta),
        );
        const hasGrounding =
          relevant.length > 0 ||
          waitingItems.length > 0 ||
          liveGmailHitCount > 0 ||
          liveDriveHitCount > 0 ||
          (finance && !financeNeedsSync);
        const verdict = confidenceFromSources({
          requiredOk: Boolean(
            (sourcePlan.required.includes("finance") && finance && !financeNeedsSync) ||
              (sourcePlan.required.includes("gmail") && liveGmailHitCount > 0) ||
              (sourcePlan.required.includes("drive") && liveDriveHitCount > 0) ||
              sourcePlan.required.length === 0,
          ),
          requiredEmptyAfterSafeFilter: false,
          stale: false,
          connectorMissing: false,
          authError: false,
          hasGrounding: Boolean(hasGrounding),
        });
        let answerText = streamed.answer;
        if (finance && !financeNeedsSync) {
          const check = verifyFinanceAmountsInAnswer(answerText, [
            finance.formatted.spent,
            finance.formatted.income,
            finance.formatted.net,
            ...finance.formatted.topPayees.map((p) => p.total),
            ...finance.transactions.slice(0, 40).map((t) => t.amountFormatted),
          ]);
          if (!check.ok) {
            answerText = buildFinanceTotalAnswer(
              finance,
              financeMetricForQuestion(retrievalQuestion),
            );
          }
        }
        const confidence = financeNeedsSync
          ? 0.4
          : verdict.confidence;
        const caveats = financeNeedsSync
          ? "Finance data needs a sync on Connectors before totals are reliable."
          : !hasGrounding
            ? "Limited matching records found."
            : null;
        return finish(
          {
            answer: answerText,
            confidence,
            caveats,
            evidence,
            relatedRecords,
            suggestedNextAction: defaultNext,
            promptVersion: QUERY_ANSWER_PROMPT_VERSION,
            degraded: streamed.degraded,
            sourcesConsulted,
          },
          { streamed: true },
        );
      }

      const ai = await aiService.answerQuery(answerRequest);
      let answerText = ai.answer;
      let caveats = ai.caveats;
      if (finance && !financeNeedsSync) {
        const check = verifyFinanceAmountsInAnswer(answerText, [
          finance.formatted.spent,
          finance.formatted.income,
          finance.formatted.net,
          ...finance.formatted.topPayees.map((p) => p.total),
          ...finance.transactions.slice(0, 40).map((t) => t.amountFormatted),
        ]);
        if (!check.ok) {
          answerText = buildFinanceTotalAnswer(
            finance,
            financeMetricForQuestion(retrievalQuestion),
          );
          caveats = [caveats, "Corrected invented dollar amounts from synced totals."]
            .filter(Boolean)
            .join(" ");
        }
      }
      if (financeNeedsSync) {
        caveats = [caveats, "Finance data needs a sync on Connectors before totals are reliable."]
          .filter(Boolean)
          .join(" ");
      }
      const hasGrounding =
        relevant.length > 0 ||
        waitingItems.length > 0 ||
        liveGmailHitCount > 0 ||
        liveDriveHitCount > 0 ||
        (finance && !financeNeedsSync);
      const verdict = confidenceFromSources({
        requiredOk: Boolean(
          (sourcePlan.required.includes("finance") && finance && !financeNeedsSync) ||
            (sourcePlan.required.includes("gmail") && liveGmailHitCount > 0) ||
            sourcePlan.required.length === 0,
        ),
        requiredEmptyAfterSafeFilter: false,
        stale: false,
        connectorMissing: false,
        authError: false,
        hasGrounding: Boolean(hasGrounding),
      });
      return finish({
        answer: answerText,
        confidence: Math.min(ai.confidence, verdict.confidence),
        caveats,
        evidence,
        relatedRecords,
        suggestedNextAction: ai.suggestedNextAction ?? defaultNext,
        promptVersion: QUERY_ANSWER_PROMPT_VERSION,
        degraded: ai.degraded,
        sourcesConsulted,
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
          (topPayee ? ` Largest: ${topPayee.payee} (${topPayee.total}).` : "");
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
      suggestedNextAction = null;
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
