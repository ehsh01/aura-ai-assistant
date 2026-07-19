import { listWaitingOnForUser } from "./waiting-on";
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
 * Compute-on-read weekly digest grounded in waiting-on and Homey alerts only.
 *
 * Deliberately excludes passive recap metrics (spend totals, open-task
 * counts, etc.) — those are informational noise, not something the user
 * needs to act on. Per product decision, this digest should only ever
 * surface things that require attention (follow-ups, home alerts), never a
 * "here's what happened" summary. If a future caller needs a pure activity
 * recap, build that as a separate, explicitly-opted-into surface.
 */
export async function getWeeklyDigestForUser(userId: string): Promise<WeeklyDigest> {
  const today = todayIso();
  const weekStart = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  })();

  const [waiting, homey] = await Promise.all([
    listWaitingOnForUser(userId, { limit: 8, maxAgeDays: 7 }),
    listOpenHomeyAlertsForUser(userId).catch(() => [] as Awaited<
      ReturnType<typeof listOpenHomeyAlertsForUser>
    >),
  ]);

  const sections: WeeklyDigestSection[] = [];

  if (waiting.length > 0) {
    sections.push({
      title: "Waiting on",
      bullets: waiting.map((w) => `${w.person}: ${w.item}`),
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
      bullets: ["Nothing needs your attention right now."],
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
