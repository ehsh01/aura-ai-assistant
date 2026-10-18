export const URL_REJECTION_RULES = {
  exactHosts: [
    "example.com",
    "example.org",
    "example.net",
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
  ],
  reservedTlds: [".example", ".invalid", ".test"],
  hostFragments: [
    "the-actual-link-here",
    "actual-link-here",
    "yourdomain",
    "your-domain",
    "your-site",
    "yoursite",
    "your-website",
    "yourwebsite",
  ],
  urlFragments: [
    "placeholder",
    "the-actual-link-here",
    "replace-me",
    "replace_this",
    "insert-link",
    "insert_url",
  ],
  trackingHostPrefixes: [
    "trk.",
    "track.",
    "click.",
    "email.",
    "links.",
    "redirect.",
    "unsubscribe.",
  ],
  trackingHostFragments: [
    "policyemail",
    "list-manage",
    "sendgrid",
    "mailchimp",
    "clicktracking",
    "emailtracking",
  ],
  trackingPathPrefixes: [
    "/track",
    "/tracking",
    "/click",
    "/redirect",
    "/unsubscribe",
    "/opt-out",
    "/optout",
  ],
  mapHosts: ["maps.google.com", "maps.app.goo.gl", "goo.gl"],
} as const;

const HTTP_URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;
const BARE_DOMAIN_PATTERN =
  /\b(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/gi;

export type ExtractedLink = {
  raw: string;
  url: string;
  index: number;
};

function cleanLink(value: string): string {
  return value.replace(/[),.;!?]+$/, "");
}

export function extractHttpUrls(text: string): string[] {
  return [...text.matchAll(HTTP_URL_PATTERN)]
    .map((match) => cleanLink(match[0]))
    .filter(Boolean);
}

export function extractLinkCandidates(text: string): ExtractedLink[] {
  const found: ExtractedLink[] = [];
  const occupied: Array<[number, number]> = [];
  for (const match of text.matchAll(HTTP_URL_PATTERN)) {
    const raw = cleanLink(match[0]);
    const index = match.index ?? 0;
    found.push({ raw, url: raw, index });
    occupied.push([index, index + match[0].length]);
  }
  for (const match of text.matchAll(BARE_DOMAIN_PATTERN)) {
    const raw = cleanLink(match[0]);
    const index = match.index ?? 0;
    if (occupied.some(([start, end]) => index >= start && index < end)) continue;
    if (text[index - 1] === "@") continue;
    found.push({ raw, url: `https://${raw}`, index });
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.index - b.index)
    .filter((candidate) => {
      const key = candidate.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function isPlaceholderUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const normalized = url.href.toLowerCase();
  if (
    URL_REJECTION_RULES.exactHosts.some(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`),
    )
  ) {
    return true;
  }
  if (
    URL_REJECTION_RULES.reservedTlds.some((suffix) => host.endsWith(suffix))
  ) {
    return true;
  }
  if (
    URL_REJECTION_RULES.hostFragments.some((fragment) =>
      host.includes(fragment),
    )
  ) {
    return true;
  }
  return URL_REJECTION_RULES.urlFragments.some((fragment) =>
    normalized.includes(fragment),
  );
}

export function isTrackingOrUtilityUrl(
  value: string,
  options: { allowMaps?: boolean } = {},
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (
    URL_REJECTION_RULES.trackingHostPrefixes.some((prefix) =>
      host.startsWith(prefix),
    ) ||
    URL_REJECTION_RULES.trackingHostFragments.some((fragment) =>
      host.includes(fragment),
    ) ||
    URL_REJECTION_RULES.trackingPathPrefixes.some((prefix) =>
      path.startsWith(prefix),
    )
  ) {
    return true;
  }
  const params = [...url.searchParams.keys()];
  const onlyCampaignParams =
    path === "/" &&
    params.length > 0 &&
    params.every(
      (key) =>
        key.toLowerCase().startsWith("utm_") ||
        key.toLowerCase().startsWith("mc_"),
    );
  if (onlyCampaignParams) return true;
  if (
    !options.allowMaps &&
    (URL_REJECTION_RULES.mapHosts.some(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`),
    ) ||
      (host.endsWith("google.com") && path.startsWith("/maps")))
  ) {
    return true;
  }
  return false;
}

export function extractRealHttpUrls(text: string): string[] {
  return extractLinkCandidates(text)
    .map((candidate) => candidate.url)
    .filter(
      (url) => !isPlaceholderUrl(url) && !isTrackingOrUtilityUrl(url),
    );
}
