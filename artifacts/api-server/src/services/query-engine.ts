import { listTasksForUser } from "./tasks";
import { listNotesForUser } from "./notes";
import { listPeopleForUser } from "./people";
import type { EvidenceDto } from "./evidence";
import { listConnectorsForUser, queryFinanceSummaryForUser } from "./connectors";
import { aiService, type QueryFinanceAggregate } from "./ai";
import { aggregateFinance, FINANCE_INTENT, parseDateRange, todayIso } from "./query-utils";
import { QUERY_ANSWER_PROMPT_VERSION } from "../prompts/queryAnswer.v1";
import { newEvidenceId } from "../lib/recall-format";

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

type ContextRecord = { entityType: string; entityId: string; title: string; text: string };

function buildContextRecords(
  tasks: Awaited<ReturnType<typeof listTasksForUser>>,
  notes: Awaited<ReturnType<typeof listNotesForUser>>,
  people: Awaited<ReturnType<typeof listPeopleForUser>>,
): ContextRecord[] {
  const records: ContextRecord[] = [];
  for (const t of tasks.slice(0, 40)) {
    records.push({
      entityType: "task",
      entityId: t.id,
      title: t.title,
      text: `${t.title} priority=${t.priority} due=${t.time ?? "none"} completed=${t.completed}`,
    });
  }
  for (const n of notes.slice(0, 30)) {
    records.push({
      entityType: "note",
      entityId: n.id,
      title: n.title,
      text: `${n.title}\n${(n.preview ?? n.content ?? "").slice(0, 400)}`,
    });
  }
  for (const p of people.slice(0, 20)) {
    records.push({
      entityType: "person",
      entityId: p.id,
      title: p.displayName,
      text: `${p.displayName} ${p.organization ?? ""} ${p.email ?? ""}`.trim(),
    });
  }
  return records;
}

function keywordRank(question: string, records: ContextRecord[]): ContextRecord[] {
  const terms = question.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (terms.length === 0) return records.slice(0, 10);
  return records
    .map((r) => ({
      r,
      score: terms.reduce((s, t) => (r.text.toLowerCase().includes(t) ? s + 1 : s), 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((x) => x.r);
}

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
 * Reads are side-effect free: evidence is assembled in-memory (not persisted).
 * When AI is enabled, answers are synthesized from the grounded context;
 * otherwise a deterministic rule-based answer is returned.
 */
export async function queryRecallForUser(
  userId: string,
  question: string,
): Promise<QueryAnswer> {
  const today = todayIso();
  const [tasks, notes, people] = await Promise.all([
    listTasksForUser(userId),
    listNotesForUser(userId),
    listPeopleForUser(userId),
  ]);

  const allRecords = buildContextRecords(tasks, notes, people);
  const relevant = keywordRank(question, allRecords);
  const openTasks = tasks.filter((t) => !t.completed);
  const degraded = aiService.getStatus().degraded;

  // Finance awareness: aggregate real transactions when the question is about money.
  let finance: QueryFinanceAggregate | null = null;
  const evidence: EvidenceDto[] = [];
  if (FINANCE_INTENT.test(question)) {
    try {
      const connectors = await listConnectorsForUser(userId);
      const financeConn = connectors.find((c) => c.type === "finance_api");
      if (financeConn) {
        const range = parseDateRange(question, today);
        const summary = await queryFinanceSummaryForUser(userId, financeConn.id, {
          startDate: range.startDate,
          endDate: range.endDate,
        });
        finance = aggregateFinance(summary.transactions, range.label);
        evidence.push(
          makeEvidence({
            claimType: "amount_calculated_from",
            evidenceText: `Net total ${finance.total} across ${finance.count} transaction(s)${
              finance.rangeLabel ? ` for ${finance.rangeLabel}` : ""
            }. Source: MyFamilyBudget finance app (source of truth).`,
            metadata: {
              rangeLabel: finance.rangeLabel,
              topPayees: finance.topPayees.slice(0, 5),
              topCategories: finance.topCategories.slice(0, 5),
              connectorId: financeConn.id,
            },
          }),
        );
      }
    } catch {
      // Finance data unavailable — proceed without it.
    }
  }

  for (const rec of relevant.slice(0, 5)) {
    evidence.push(
      makeEvidence({
        claimType: "summary_based_on",
        evidenceText: rec.text.slice(0, 500),
        metadata: { relatedEntityType: rec.entityType, relatedEntityId: rec.entityId },
      }),
    );
  }

  const relatedRecords = relevant.map((r) => ({
    entityType: r.entityType,
    entityId: r.entityId,
    title: r.title,
  }));

  // AI synthesis when available.
  if (!degraded) {
    try {
      const ai = await aiService.answerQuery({ question, today, records: relevant, finance });
      return {
        answer: ai.answer,
        confidence: ai.confidence,
        caveats: ai.caveats,
        evidence,
        relatedRecords,
        suggestedNextAction: ai.suggestedNextAction,
        promptVersion: QUERY_ANSWER_PROMPT_VERSION,
        degraded: ai.degraded,
      };
    } catch {
      // Fall through to rule-based answer.
    }
  }

  // Deterministic fallback.
  let answer: string;
  let confidence = relevant.length > 0 || finance ? 0.6 : 0.3;
  let caveats: string | null = relevant.length === 0 && !finance ? "Limited matching records found." : null;
  let suggestedNextAction: string | null = null;

  if (finance) {
    const topPayee = finance.topPayees[0];
    answer =
      `Net total is $${finance.total.toFixed(2)} across ${finance.count} transaction(s)` +
      `${finance.rangeLabel ? ` for ${finance.rangeLabel}` : ""}.` +
      (topPayee ? ` Largest: ${topPayee.payee} ($${topPayee.total.toFixed(2)}).` : "");
    confidence = 0.8;
    suggestedNextAction = "Open Connectors → Finance for the full breakdown";
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
    answer = `I found ${relevant.length} related record(s). Top match: "${relevant[0]!.title}". ${relevant[0]!.text.slice(0, 200)}`;
    suggestedNextAction = `Review ${relevant[0]!.entityType}: ${relevant[0]!.title}`;
  } else {
    answer =
      "I don't have enough matching records to answer confidently. Try capturing more context or connecting a data source.";
    confidence = 0.2;
  }

  return {
    answer,
    confidence,
    caveats,
    evidence,
    relatedRecords,
    suggestedNextAction,
    promptVersion: QUERY_ANSWER_PROMPT_VERSION,
    degraded,
  };
}
