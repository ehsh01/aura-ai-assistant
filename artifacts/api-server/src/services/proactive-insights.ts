/**
 * Phase 4 Slice A — evidence-backed proactive insights from existing data.
 * Domain tables (Vehicle/Home/Warranty CRUD) stay deferred until structured dates exist.
 */
import { and, desc, eq } from "drizzle-orm";
import { sourceRecords } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { listConnectorsForUser } from "./connectors";
import { listMemoriesForUser } from "./life-memory";
import type { RecallNoteMetadataDto } from "./notes";
import type { RecallProjectDto } from "./projects";
import type { RecallTaskDto } from "./tasks";
import { listWaitingOnForUser } from "./waiting-on";

export type ProactiveInsightKind =
  | "no-task"
  | "stale"
  | "follow-up"
  | "related"
  | "recurring-payment"
  | "project-change"
  | "warranty";

export type ProactiveInsight = {
  id: string;
  kind: ProactiveInsightKind;
  text: string;
  href?: string;
  evidence?: string;
};

const WARRANTY_RE =
  /\b(warranty|warranties|guaranteed until|expires?\s+on|valid\s+until|exp(?:ires|iry)?[:\s]+)\b/i;
const DATE_TOKEN_RE =
  /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/i;

/** Pure: find payees that appear often enough to look like recurring charges. */
export function findRecurringPayees(
  transactions: { payee: string; date: string; amount: number }[],
  opts?: { minCount?: number; lookbackDays?: number },
): { payee: string; count: number; total: number }[] {
  const minCount = opts?.minCount ?? 3;
  const lookbackDays = opts?.lookbackDays ?? 90;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const byPayee = new Map<string, { count: number; total: number; display: string }>();
  for (const tx of transactions) {
    if (!tx.date || tx.date < cutoffIso) continue;
    // Recurring charges are usually expenses (negative or positive depending on ledger).
    const payee = tx.payee.trim();
    if (payee.length < 2 || /^unknown$/i.test(payee)) continue;
    const key = payee.toLowerCase();
    const cur = byPayee.get(key) ?? { count: 0, total: 0, display: payee };
    cur.count += 1;
    cur.total += Math.abs(tx.amount);
    byPayee.set(key, cur);
  }

  return [...byPayee.values()]
    .filter((p) => p.count >= minCount)
    .sort((a, b) => b.count - a.count || b.total - a.total)
    .map((p) => ({ payee: p.display, count: p.count, total: p.total }));
}

/** Pure: extract a soft warranty hint from memory text when a date is present. */
export function extractWarrantyHint(
  title: string,
  content: string,
): { summary: string; dateToken: string } | null {
  const blob = `${title}\n${content}`;
  if (!WARRANTY_RE.test(blob)) return null;
  const dateMatch = blob.match(DATE_TOKEN_RE);
  if (!dateMatch?.[1]) return null;
  const dateToken = dateMatch[1];
  const summary = title.trim() || content.trim().slice(0, 80) || "Warranty";
  return { summary, dateToken };
}

/** Pure: projects with recent notes/tasks and remaining open work. */
export function findProjectChangeSignals(
  projects: RecallProjectDto[],
  notes: RecallNoteMetadataDto[],
  tasks: RecallTaskDto[],
  opts?: { recentDays?: number },
): { projectId: string; projectName: string; noteCount: number; openTasks: number }[] {
  const recentDays = opts?.recentDays ?? 7;
  const now = Date.now();
  const out: { projectId: string; projectName: string; noteCount: number; openTasks: number }[] =
    [];

  for (const project of projects) {
    const recentNotes = notes.filter((n) => {
      if (n.projectId !== project.id) return false;
      const t = new Date(n.updatedAt ?? n.createdAt).getTime();
      if (Number.isNaN(t)) return false;
      return (now - t) / 86_400_000 <= recentDays;
    });
    const openTasks = tasks.filter((t) => t.projectId === project.id && !t.completed);
    if (recentNotes.length === 0 && openTasks.length === 0) continue;
    if (recentNotes.length === 0 && openTasks.length < 2) continue;
    out.push({
      projectId: project.id,
      projectName: project.name,
      noteCount: recentNotes.length,
      openTasks: openTasks.length,
    });
  }

  return out.sort((a, b) => b.noteCount + b.openTasks - (a.noteCount + a.openTasks));
}

async function loadFinanceTxSamples(
  userId: string,
): Promise<{ payee: string; date: string; amount: number }[]> {
  const connectors = await listConnectorsForUser(userId);
  const financeConn = connectors.find((c) => c.type === "finance_api");
  if (!financeConn) return [];

  const rows = await getDb()
    .select({
      recordMetadata: sourceRecords.recordMetadata,
      sourceCreatedAt: sourceRecords.sourceCreatedAt,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.connectorId, financeConn.id),
        eq(sourceRecords.recordType, "finance_transaction"),
      ),
    )
    .orderBy(desc(sourceRecords.sourceCreatedAt))
    .limit(2000);

  return rows
    .map((row) => {
      const meta = row.recordMetadata ?? {};
      const amount = typeof meta.amount === "number" ? meta.amount : Number(meta.amount);
      if (!Number.isFinite(amount)) return null;
      const date =
        (typeof meta.date === "string" && meta.date) ||
        (row.sourceCreatedAt ? row.sourceCreatedAt.toISOString().slice(0, 10) : "");
      const payee = typeof meta.payee === "string" ? meta.payee : "Unknown";
      return { payee, date, amount };
    })
    .filter((t): t is NonNullable<typeof t> => t != null);
}

/**
 * Merge classic home heuristics with proactive Phase 4 insights.
 * Prefer evidence-backed stale follow-ups over keyword-only follow-up guesses.
 */
export async function buildProactiveInsights(
  userId: string,
  input: {
    tasks: RecallTaskDto[];
    notes: RecallNoteMetadataDto[];
    projects: RecallProjectDto[];
    classic: ProactiveInsight[];
  },
  limit = 6,
): Promise<ProactiveInsight[]> {
  const insights: ProactiveInsight[] = [];
  const seen = new Set<string>();

  const push = (item: ProactiveInsight) => {
    if (insights.length >= limit) return;
    if (seen.has(item.id)) return;
    seen.add(item.id);
    insights.push(item);
  };

  // 1) Stale follow-ups with evidence (older than Today's 1-day waiting surface).
  const staleWaiting = await listWaitingOnForUser(userId, {
    limit: 8,
    minAgeDays: 2,
    maxAgeDays: 30,
  }).catch(() => []);

  for (const w of staleWaiting) {
    if (w.days < 2) continue;
    push({
      id: `stale-wait-${w.id}`,
      kind: "follow-up",
      text: `Still waiting on ${w.person} for “${w.item}” (${w.days} day${w.days === 1 ? "" : "s"}).`,
      href: w.href,
      evidence: w.evidenceText,
    });
  }

  // 2) Recurring payments from synced finance.
  const txs = await loadFinanceTxSamples(userId).catch(() => []);
  const recurring = findRecurringPayees(txs, { minCount: 3, lookbackDays: 90 });
  for (const r of recurring.slice(0, 2)) {
    push({
      id: `recur-${r.payee.toLowerCase().replace(/\s+/g, "-").slice(0, 40)}`,
      kind: "recurring-payment",
      text: `${r.payee} showed up ${r.count} times in the last 90 days — looks like a recurring charge.`,
      href: "/connectors",
      evidence: `${r.count} transactions, ~$${r.total.toFixed(0)} total magnitude`,
    });
  }

  // 3) Project change / open work.
  const projectSignals = findProjectChangeSignals(input.projects, input.notes, input.tasks);
  for (const p of projectSignals.slice(0, 2)) {
    const bits = [
      p.noteCount > 0 ? `${p.noteCount} recent note${p.noteCount === 1 ? "" : "s"}` : null,
      p.openTasks > 0 ? `${p.openTasks} open task${p.openTasks === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    push({
      id: `project-change-${p.projectId}`,
      kind: "project-change",
      text: `${p.projectName} has activity worth a look (${bits.join(", ")}).`,
      href: `/projects/${encodeURIComponent(p.projectId)}`,
    });
  }

  // 4) Soft warranty hints from Life Memory (only when a date is present).
  const [vehicleMemories, homeMemories] = await Promise.all([
    listMemoriesForUser(userId, { domain: "vehicles", limit: 40 }).catch(() => []),
    listMemoriesForUser(userId, { domain: "home", limit: 40 }).catch(() => []),
  ]);
  for (const m of [...vehicleMemories, ...homeMemories]) {
    const hint = extractWarrantyHint(m.title, m.content);
    if (!hint) continue;
    push({
      id: `warranty-${m.id}`,
      kind: "warranty",
      text: `Warranty note “${hint.summary}” mentions ${hint.dateToken} — worth confirming it’s still active.`,
      href: `/memory?memory=${encodeURIComponent(m.id)}`,
      evidence: m.content.slice(0, 200),
    });
  }

  // 5) Fill remaining slots with classic heuristics (skip weak keyword follow-ups if we have evidence).
  const hasEvidenceFollowUps = insights.some((i) => i.kind === "follow-up");
  for (const c of input.classic) {
    if (hasEvidenceFollowUps && c.kind === "follow-up") continue;
    push(c);
  }

  return insights.slice(0, limit);
}
