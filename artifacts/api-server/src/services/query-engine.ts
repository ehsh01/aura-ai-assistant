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
      { noteSearchQuery: question },
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
    // Don't block the answer on an external MyFamilyBudget sync. Serve the
    // currently-synced data now and refresh in the background for next time;
    // loadSyncedFinanceAggregate still flags needsSync when nothing is synced yet.
    void ensureUserFinanceFresh(userId, { awaitSync: false });
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
    isEmailSearchIntent(question) || isEmailSearchIntent(retrievalQuestion);
  const wantsDriveAsk =
    isDriveSearchIntent(question) || isDriveSearchIntent(retrievalQuestion);

  const retrievalContext = relevant.map((r, rankIndex) => {
    const date = formatInstantForUser(r.updatedAt);
    const body = promptTextForRetrievedRecord(r, {
      question,
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

  if (wantsEmailAsk || wantsDriveAsk) {
    const mailboxes = await getConnectedGoogleMailboxes(userId);
    const mailboxHint = extractMailboxHint(question, mailboxes);
    const accountsLabel =
      mailboxes.length > 0 ? mailboxes.join(", ") : "your connected Google accounts";

    const [gmailPlanRaw, drivePlan] = await Promise.all([
      wantsEmailAsk
        ? planGmailSearch(retrievalQuestion).then((p) =>
            p ??
            (retrievalQuestion.trim() !== question.trim()
              ? planGmailSearch(question)
              : null),
          )
        : Promise.resolve(null),
      wantsDriveAsk
        ? planDriveSearch(retrievalQuestion).then((p) =>
            p ??
            (retrievalQuestion.trim() !== question.trim()
              ? planDriveSearch(question)
              : null),
          )
        : Promise.resolve(null),
    ]);

    const gmailPlan = wantsEmailAsk
      ? backfillGmailPlanWithNamedPerson(
          gmailPlanRaw,
          namedPeople[0],
          retrievalQuestion,
          question,
        )
      : gmailPlanRaw;

    const [gmailHits, driveHits] = await Promise.all([
      gmailPlan?.query
        ? liveSearchGmailForUser(userId, gmailPlan.query, {
            mailboxHint,
            maxPerMailbox: 15,
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

    if (gmailPlan?.query) {
      for (const hit of gmailHits.slice(0, 24)) {
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
      if (gmailHits.length === 0) {
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
          relevant.length > 0 || waitingItems.length > 0 || (finance && !financeNeedsSync);
        const confidence = financeNeedsSync
          ? 0.4
          : finance
            ? 0.85
            : hasGrounding
              ? usedSemantic
                ? 0.8
                : 0.72
              : 0.4;
        const caveats = financeNeedsSync
          ? "Finance data needs a sync on Connectors before totals are reliable."
          : !hasGrounding
            ? "Limited matching records found."
            : null;
        return finish(
          {
            answer: streamed.answer,
            confidence,
            caveats,
            evidence,
            relatedRecords,
            suggestedNextAction: defaultNext,
            promptVersion: QUERY_ANSWER_PROMPT_VERSION,
            degraded: streamed.degraded,
          },
          { streamed: true },
        );
      }

      const ai = await aiService.answerQuery(answerRequest);
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
