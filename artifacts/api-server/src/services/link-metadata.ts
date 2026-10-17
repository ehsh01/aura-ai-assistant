import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

type RawResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
};

export type LinkMetadataDeps = {
  lookup?: (hostname: string) => Promise<LookupAddress[]>;
  request?: (
    url: URL,
    address: LookupAddress,
    signal: AbortSignal,
    maxBytes: number,
  ) => Promise<RawResponse>;
};

export type LinkMetadata = {
  title: string;
  description: string | null;
  domain: string;
  imageUrl: string | null;
  canonicalUrl: string;
};

function ipv4Number(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

function inV4Range(value: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

/** Reject every non-public range that could reach internal infrastructure. */
export function isPrivateAddress(rawAddress: string): boolean {
  let address = rawAddress.toLowerCase().replace(/^\[|\]$/g, "");
  if (address.startsWith("::ffff:")) address = address.slice(7);

  const v4 = ipv4Number(address);
  if (v4 !== null) {
    const blocked: Array<[string, number]> = [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
    ];
    return blocked.some(([base, bits]) => inV4Range(v4, ipv4Number(base)!, bits));
  }

  if (isIP(address) !== 6) return true;
  return (
    address === "::" ||
    address === "::1" ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    /^fe[89ab]/.test(address)
  );
}

async function defaultLookup(hostname: string): Promise<LookupAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

function defaultRequest(
  url: URL,
  selected: LookupAddress,
  signal: AbortSignal,
  maxBytes: number,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = transport(
      url,
      {
        method: "GET",
        signal,
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9",
          "User-Agent": "RecallMetadata/1.0",
        },
        lookup: ((_hostname: string, _options: unknown, callback: (...args: unknown[]) => void) => {
          callback(null, selected.address, selected.family);
        }) as never,
      },
      (response) => {
        const contentLength = Number(response.headers["content-length"] ?? 0);
        if (contentLength > maxBytes) {
          response.destroy();
          reject(new Error("Link response exceeds size cap"));
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            response.destroy(new Error("Link response exceeds size cap"));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
        response.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

function metaValues(html: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const attr of match[0].matchAll(
      /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g,
    )) {
      attrs.set(attr[1]!.toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? "");
    }
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    const content = attrs.get("content");
    if (key && content && !values.has(key)) values.set(key, decodeEntities(content));
  }
  return values;
}

export function parseLinkMetadata(html: string, pageUrl: URL): LinkMetadata {
  const meta = metaValues(html);
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title =
    meta.get("og:title") ||
    meta.get("twitter:title") ||
    (titleMatch ? decodeEntities(titleMatch[1]!.replace(/<[^>]+>/g, "")) : "") ||
    pageUrl.hostname;
  const rawImage = meta.get("og:image") ?? meta.get("twitter:image") ?? null;
  let imageUrl: string | null = null;
  if (rawImage) {
    try {
      imageUrl = new URL(rawImage, pageUrl).toString();
    } catch {
      imageUrl = null;
    }
  }
  return {
    title: title.slice(0, 500),
    description:
      (meta.get("og:description") ?? meta.get("description") ?? null)?.slice(0, 2_000) ?? null,
    domain: pageUrl.hostname.toLowerCase().replace(/^www\./, ""),
    imageUrl,
    canonicalUrl: pageUrl.toString(),
  };
}

function validateUrl(input: string): URL {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https links can be saved");
  }
  if (url.username || url.password) throw new Error("Links with credentials are not allowed");
  if (url.hostname.toLowerCase() === "localhost") throw new Error("Private network links are blocked");
  return url;
}

export function canonicalizeUrl(input: string): string {
  const url = validateUrl(input.trim());
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

export async function fetchLinkMetadata(
  input: string,
  options: LinkMetadataDeps & { timeoutMs?: number; maxBytes?: number } = {},
): Promise<LinkMetadata> {
  let url = validateUrl(canonicalizeUrl(input));
  const lookup = options.lookup ?? defaultLookup;
  const request = options.request ?? defaultRequest;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const addresses = await lookup(url.hostname);
    if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
      throw new Error("Private network links are blocked");
    }

    const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const response = await request(url, addresses[0]!, signal, maxBytes);
    if (response.body.length > maxBytes) throw new Error("Link response exceeds size cap");

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = firstHeader(response.headers, "location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("Too many link redirects");
      url = validateUrl(new URL(location, url).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Link returned HTTP ${response.status}`);
    }

    const contentType = firstHeader(response.headers, "content-type") ?? "";
    if (!/html|xhtml/i.test(contentType)) {
      return {
        title: url.pathname.split("/").filter(Boolean).at(-1) || url.hostname,
        description: null,
        domain: url.hostname.toLowerCase().replace(/^www\./, ""),
        imageUrl: null,
        canonicalUrl: canonicalizeUrl(url.toString()),
      };
    }
    return parseLinkMetadata(response.body.toString("utf8"), url);
  }
  throw new Error("Too many link redirects");
}
