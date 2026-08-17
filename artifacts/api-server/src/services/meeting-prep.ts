import type { BriefingCalendarEntry } from "./briefing";

export type MeetingPrepItem = {
  eventId: string;
  title: string;
  startLabel: string | null;
  personName: string | null;
  personHref: string | null;
  waitingCount: number;
  recentContext: string | null;
  href: string;
};

function nameInTitle(name: string, title: string): boolean {
  const n = name.trim().toLowerCase();
  if (n.length < 2) return false;
  const first = n.split(/\s+/)[0] ?? n;
  const hay = title.toLowerCase();
  return hay.includes(n) || (first.length >= 3 && hay.includes(first));
}

/**
 * Grounded meeting prep from today's calendar + people + waiting items.
 * Never invents attendees — only links when a known name appears in the title.
 */
export function buildMeetingPrep(input: {
  calendarToday: BriefingCalendarEntry[];
  people: { id: string; displayName: string }[];
  waiting: { ownerName: string | null; ownerPersonId?: string | null; deliverable: string }[];
}): MeetingPrepItem[] {
  return input.calendarToday.slice(0, 6).map((event) => {
    const person = input.people.find((p) => nameInTitle(p.displayName, event.title)) ?? null;
    const waitingHits = input.waiting.filter((w) => {
      if (person && w.ownerPersonId && w.ownerPersonId === person.id) return true;
      if (person && w.ownerName && nameInTitle(w.ownerName, person.displayName)) return true;
      if (w.ownerName && nameInTitle(w.ownerName, event.title)) return true;
      return false;
    });
    return {
      eventId: event.id,
      title: event.title,
      startLabel: event.startLabel,
      personName: person?.displayName ?? null,
      personHref: person ? `/people/${encodeURIComponent(person.id)}` : null,
      waitingCount: waitingHits.length,
      recentContext: waitingHits[0]
        ? `Waiting on ${waitingHits[0]!.ownerName ?? "them"}: ${waitingHits[0]!.deliverable}`
        : person
          ? `Linked to ${person.displayName}`
          : null,
      href: event.href,
    };
  });
}
