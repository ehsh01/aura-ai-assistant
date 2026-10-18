export const PLACEHOLDER_URL_RULES = {
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
} as const;

const HTTP_URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;

export function extractHttpUrls(text: string): string[] {
  return [...text.matchAll(HTTP_URL_PATTERN)]
    .map((match) => match[0].replace(/[),.;!?]+$/, ""))
    .filter(Boolean);
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
    PLACEHOLDER_URL_RULES.exactHosts.some(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`),
    )
  ) {
    return true;
  }
  if (
    PLACEHOLDER_URL_RULES.reservedTlds.some((suffix) => host.endsWith(suffix))
  ) {
    return true;
  }
  if (
    PLACEHOLDER_URL_RULES.hostFragments.some((fragment) =>
      host.includes(fragment),
    )
  ) {
    return true;
  }
  return PLACEHOLDER_URL_RULES.urlFragments.some((fragment) =>
    normalized.includes(fragment),
  );
}

export function extractRealHttpUrls(text: string): string[] {
  return extractHttpUrls(text).filter((url) => !isPlaceholderUrl(url));
}
