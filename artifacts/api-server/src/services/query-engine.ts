import { listTasksForUser } from "./tasks";
import { listNotesForUser } from "./notes";
import { listPeopleForUser } from "./people";
import { createEvidenceForUser, type EvidenceDto } from "./evidence";
import { aiService } from "./ai";
import { QUERY_ANSWER_PROMPT_VERSION } from "../prompts/queryAnswer.v1";

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

function buildContextRecords(
  tasks: Awaited<ReturnType<typeof listTasksForUser>>,
  notes: Awaited<ReturnType<typeof listNotesForUser>>,
  people: Awaited<ReturnType<typeof listPeopleForUser>>,
): { entityType: string; entityId: string; title: string; text: string }[] {
  const records: { entityType: string; entityId: string; title: string; text: string }[] = [];
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

function keywordRank(
  question: string,
  records: ReturnType<typeof buildContextRecords>,
): typeof records {
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

/** Natural-language query with evidence-backed assembly (Phase 8). */
export async function queryRecallForUser(
  userId: string,
  question: string,
): Promise<QueryAnswer> {
  const [tasks, notes, people] = await Promise.all([
    listTasksForUser(userId),
    listNotesForUser(userId),
    listPeopleForUser(userId),
  ]);

  const allRecords = buildContextRecords(tasks, notes, people);
  const relevant = keywordRank(question, allRecords);

  const openTasks = tasks.filter((t) => !t.completed);
  const degraded = aiService.getStatus().degraded;

  let answer: string;
  let confidence = relevant.length > 0 ? 0.65 : 0.35;
  let caveats: string | null = relevant.length === 0 ? "Limited matching records found." : null;
  let suggestedNextAction: string | null = null;

  if (/attention|today|focus|do today/i.test(question)) {
    const dueToday = openTasks.filter((t) => t.time && t.time.startsWith(new Date().toISOString().slice(0, 10)));
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
    answer = "I don't have enough matching records to answer confidently. Try capturing more context or connecting a data source.";
    confidence = 0.2;
  }

  const evidence: EvidenceDto[] = [];
  for (const rec of relevant.slice(0, 5)) {
    const ev = await createEvidenceForUser(userId, {
      entityType: "query_answer",
      entityId: `q-${Date.now()}`,
      claimType: "summary_based_on",
      evidenceText: rec.text.slice(0, 500),
      evidenceMetadata: {
        question,
        relatedEntityType: rec.entityType,
        relatedEntityId: rec.entityId,
        promptVersion: QUERY_ANSWER_PROMPT_VERSION,
      },
    });
    evidence.push(ev);
  }

  return {
    answer,
    confidence,
    caveats,
    evidence,
    relatedRecords: relevant.map((r) => ({
      entityType: r.entityType,
      entityId: r.entityId,
      title: r.title,
    })),
    suggestedNextAction,
    promptVersion: QUERY_ANSWER_PROMPT_VERSION,
    degraded,
  };
}
