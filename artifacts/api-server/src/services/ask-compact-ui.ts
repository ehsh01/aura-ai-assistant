/** Compact Ask: keep only setup/error CTAs (not “ask for a breakdown” etc.). */
export function compactSuggestedNextAction(
  action: string | null | undefined,
  opts?: { answer?: string; confidence?: number; caveats?: string | null },
): string | null {
  if (!action) return null;
  if (/^Reply\s+[“"']/i.test(action)) return action;
  const blob = `${opts?.answer ?? ""} ${opts?.caveats ?? ""} ${action}`;
  const setupOrError =
    (opts?.confidence != null && opts.confidence < 0.55) ||
    /not connected|not synced|no synced|can't search|couldn't|connect google|connect finance|connectors and connect|person not resolved/i.test(
      blob,
    );
  if (!setupOrError) return null;
  if (/Open Connectors/i.test(action)) return action;
  if (/Sync Finance/i.test(action)) return action;
  if (/Open People/i.test(action)) return action;
  return null;
}

export function primaryLinkLabelForUrl(url: string): string {
  if (/mail\.google\.com/i.test(url)) return "Open in Gmail";
  if (/(drive|docs|sheets|slides)\.google\.com/i.test(url)) return "Open in Drive";
  return "Open source";
}

/** Mark the best-ranked evidence item that has an external URL as the primary link. */
export function annotatePrimaryExternalLink<
  T extends { evidenceMetadata: Record<string, unknown> },
>(evidence: T[]): T[] {
  const idx = evidence.findIndex((ev) => {
    const url = ev.evidenceMetadata?.sourceUrl;
    return typeof url === "string" && /^https?:\/\//i.test(url);
  });
  if (idx < 0) return evidence;
  return evidence.map((ev, i) => {
    if (i !== idx) return ev;
    const url = String(ev.evidenceMetadata?.sourceUrl);
    const existing =
      typeof ev.evidenceMetadata?.primaryLinkLabel === "string"
        ? ev.evidenceMetadata.primaryLinkLabel
        : null;
    return {
      ...ev,
      evidenceMetadata: {
        ...ev.evidenceMetadata,
        primaryLinkLabel: existing ?? primaryLinkLabelForUrl(url),
      },
    };
  });
}
