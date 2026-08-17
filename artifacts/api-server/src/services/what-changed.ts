export type WhatChangedKind = "waiting" | "deadline" | "inbox" | "homey";

export type WhatChangedItem = {
  id: string;
  kind: WhatChangedKind;
  title: string;
  detail: string;
  href: string;
};

function after(iso: string | null | undefined, since: Date): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t > since.getTime();
}

/**
 * Diff since the user last opened Today. Empty when nothing new landed.
 */
export function buildWhatChanged(input: {
  since: Date;
  waiting: { id: string; deliverable: string; ownerName: string | null; href: string; updatedAt?: string | null; createdAt?: string | null }[];
  attention: { id: string; title: string; href: string; updatedAt?: string | null; createdAt?: string | null; kind?: string | null }[];
  inbox: { id: string; cleanedTitle?: string | null; title?: string | null; href?: string; createdAt?: string | null }[];
  homey: { id: string; title: string; createdAt?: string | null }[];
}): WhatChangedItem[] {
  const items: WhatChangedItem[] = [];

  for (const w of input.waiting) {
    if (!after(w.updatedAt ?? w.createdAt, input.since)) continue;
    items.push({
      id: `waiting:${w.id}`,
      kind: "waiting",
      title: w.deliverable,
      detail: w.ownerName ? `Waiting on ${w.ownerName}` : "Waiting item updated",
      href: w.href,
    });
  }
  for (const a of input.attention) {
    if (!after(a.updatedAt ?? a.createdAt, input.since)) continue;
    items.push({
      id: `deadline:${a.id}`,
      kind: "deadline",
      title: a.title,
      detail: a.kind === "appointment" ? "Appointment updated" : "Deadline updated",
      href: a.href,
    });
  }
  for (const c of input.inbox) {
    if (!after(c.createdAt, input.since)) continue;
    items.push({
      id: `inbox:${c.id}`,
      kind: "inbox",
      title: c.cleanedTitle || c.title || "New capture",
      detail: "New capture to review",
      href: c.href || `/inbox?capture=${encodeURIComponent(c.id)}`,
    });
  }
  for (const h of input.homey) {
    if (!after(h.createdAt, input.since)) continue;
    items.push({
      id: `homey:${h.id}`,
      kind: "homey",
      title: h.title,
      detail: "Home alert",
      href: "/connectors",
    });
  }

  return items.slice(0, 8);
}
