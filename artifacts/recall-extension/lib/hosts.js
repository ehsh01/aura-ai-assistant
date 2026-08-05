/**
 * Approved Microsoft hosts for Outlook Web and Teams Web only.
 * The extension must not observe or capture any other site.
 */

export const OUTLOOK_HOSTS = [
  "outlook.office.com",
  "outlook.office365.com",
  "outlook.live.com",
];

export const TEAMS_HOSTS = ["teams.microsoft.com", "teams.live.com"];

export const APPROVED_HOSTS = [...OUTLOOK_HOSTS, ...TEAMS_HOSTS];

/** @param {string | null | undefined} hostname */
export function normalizeHostname(hostname) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

/**
 * True when the hostname is exactly an approved host or a subdomain of one.
 * @param {string | null | undefined} hostname
 */
export function isAllowedHost(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return false;
  return APPROVED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * @param {string | null | undefined} hostname
 * @returns {"outlook" | "teams" | null}
 */
export function classifyHost(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return null;
  if (OUTLOOK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return "outlook";
  if (TEAMS_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return "teams";
  return null;
}
