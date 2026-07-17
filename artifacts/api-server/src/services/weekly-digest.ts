import { listWaitingOnForUser } from "./waiting-on";
import { listTasksForUser } from "./tasks";
import { loadSyncedFinanceAggregate } from "./finance-sync";
import { listOpenHomeyAlertsForUser } from "./homey-alerts";
import { todayIso } from "./query-utils";

export type WeeklyDigestSection = {
  title: string;
  bullets: string[];
};

export type WeeklyDigest = {
  weekOf: string;
  generatedAt: string;
  sections: WeeklyDigestSection[];
  summary: string;
};

/**
 * Compute-on-read weekly digest grounded in waiting-on, tasks, finance, Homey.
 */
export async function getWeeklyDigestForUser(userId: string): Promise<WeeklyDigest> {
  const today = todayIso();
  const weekStart = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  })();

  const [waiting, tasks, finance, homey] = await Promise.all([
    listWaitingOnForUser(userId, { limit: 8, maxAgeDays: 7 }),
    listTasksForUser(userId, { limit: 40 }),
    loadSyncedFinanceAggregate(userId, "last 7 days", today).catch(() => null),
    listOpenHomeyAlertsForUser(userId).catch(() => [] as Awaited<
      ReturnType<typeof listOpenHomeyAlertsForUser>
    >),
  ]);

  const openTasks = tasks.filter((t) => !t.completed).slice(0, 8);
  const sections: WeeklyDigestSection[] = [];

  if (waiting.length > 0) {
    sections.push({
      title: "Waiting on",
      bullets: waiting.map((w) => `${w.person}: ${w.item}`),
    });
  }
  if (openTasks.length > 0) {
    sections.push({
      title: "Open tasks",
      bullets: openTasks.map((t) => t.title),
    });
  }
  if (finance && !finance.needsSync) {
    sections.push({
      title: "Spending (last 7 days)",
      bullets: [
        `Spent ${finance.finance.formatted.spent} across ${finance.finance.expenseCount} expense(s)`,
        ...(finance.finance.formatted.topPayees.slice(0, 3).map(
          (p) => `${p.payee}: ${p.total} (${p.count})`,
        ) ?? []),
      ],
    });
  }
  if (homey.length > 0) {
    sections.push({
      title: "Homey alerts",
      bullets: homey.slice(0, 5).map((a) => a.title || a.message || "Alert"),
    });
  }

  if (sections.length === 0) {
    sections.push({
      title: "This week",
      bullets: ["Nothing urgent surfaced from waiting-on, tasks, finance, or Homey."],
    });
  }

  const summary = sections
    .map((s) => `${s.title}: ${s.bullets.slice(0, 2).join("; ")}`)
    .join(" · ")
    .slice(0, 400);

  return {
    weekOf: weekStart,
    generatedAt: new Date().toISOString(),
    sections,
    summary,
  };
}
