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
  allowedTlds: [
    "com",
    "org",
    "net",
    "edu",
    "gov",
    "io",
    "co",
    "us",
    "app",
    "info",
    "biz",
    "me",
    "ai",
    "dev",
    "health",
    "uk",
    "ca",
    "au",
    "nz",
    "de",
    "fr",
    "es",
    "it",
    "nl",
    "ch",
    "se",
    "no",
    "dk",
    "fi",
    "ie",
    "jp",
    "cn",
    "in",
    "br",
    "mx",
    "za",
    "sg",
    "ae",
  ],
  fileExtensionTlds: [
    "pdf",
    "doc",
    "docx",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "svg",
    "html",
    "htm",
    "txt",
    "rtf",
    "xls",
    "xlsx",
  ],
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

function hasAllowedTld(hostname: string): boolean {
  const tld = hostname.toLowerCase().replace(/\.$/, "").split(".").pop() ?? "";
  return (
    URL_REJECTION_RULES.allowedTlds.includes(
      tld as (typeof URL_REJECTION_RULES.allowedTlds)[number],
    ) &&
    !URL_REJECTION_RULES.fileExtensionTlds.includes(
      tld as (typeof URL_REJECTION_RULES.fileExtensionTlds)[number],
    )
  );
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
    const before = text[index - 1] ?? "";
    const after = text[index + match[0].length] ?? "";
    const prefix = text.slice(Math.max(0, index - 7), index).toLowerCase();
    if (before === "@" || before === "/" || after === "@" || prefix === "mailto:") {
      continue;
    }
    const normalized = `https://${raw}`;
    if (!hasAllowedTld(new URL(normalized).hostname)) continue;
    found.push({ raw, url: normalized, index });
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
  if (!hasAllowedTld(host)) return true;
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
