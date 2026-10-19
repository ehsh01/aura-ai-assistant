import { AsyncLocalStorage } from "node:async_hooks";
import { isIP } from "node:net";

export const HIDDEN_CREDENTIAL = "[hidden credential]";
export const HIDDEN_ADDRESS = "[hidden address]";

type RedactionMemory = {
  credentials: Set<string>;
  addresses: Set<string>;
};

const credentialScope = new AsyncLocalStorage<RedactionMemory>();

export function withCredentialRedactionScope<T>(
  operation: () => T,
  seed: Iterable<string> = [],
  addressSeed: Iterable<string> = [],
): T {
  const existing = credentialScope.getStore();
  if (existing) {
    for (const value of seed) rememberCredential(value);
    for (const value of addressSeed) rememberAddress(value);
    return operation();
  }
  return credentialScope.run(
    {
      credentials: new Set<string>(),
      addresses: new Set<string>(),
    },
    () => {
      for (const value of seed) rememberCredential(value);
      for (const value of addressSeed) rememberAddress(value);
      return operation();
    },
  );
}

export function learnedCredentialValues(): string[] {
  return [...(credentialScope.getStore()?.credentials ?? [])];
}

export function learnedAddressValues(): string[] {
  return [...(credentialScope.getStore()?.addresses ?? [])];
}

function rememberCredential(value: string): void {
  if (value.includes("[")) return;
  const normalized = value
    .replace(/^["']|["']$/g, "")
    .replace(/^[<>"']+|[<>"']+$/g, "")
    .trim();
  const credentialLike =
    /\d|[@:/+_=<>-]/.test(normalized) ||
    (/[a-z]/.test(normalized) && /[A-Z]/.test(normalized)) ||
    normalized.length >= 12;
  if (
    normalized.length >= 6 &&
    credentialLike &&
    !normalized.startsWith("[") &&
    !normalized.includes("\uE000") &&
    !/hidden|credential\]/i.test(normalized)
  ) {
    credentialScope.getStore()?.credentials.add(normalized);
  }
}

function rememberAddress(value: string): void {
  const normalized = value.trim().replace(/^\[|\]$/g, "");
  if (
    normalized.length > 0 &&
    !normalized.includes("[") &&
    !normalized.includes("\uE000") &&
    !/hidden|address\]/i.test(normalized)
  ) {
    credentialScope.getStore()?.addresses.add(normalized);
  }
}

const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/gi;
const INLINE_PASSWORD =
  /\b((?:(?:ssh|database|db)\s+)?(?:password|passwd|pass|pwd|pin)\s*(?:is|[:=])\s*)([^\s,;]+)/gi;
const USERINFO_TOKEN =
  /\b((?:[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9._-]+:)|(?:[A-Za-z0-9._-]+:(?!\/\/)))([^\s]+)/gi;
const SSHPASS_PASSWORD = /\b(sshpass\s+-p\s+)("[^"]*"|'[^']*'|\S+)/gi;
const UPPER_SNAKE_CREDENTIAL =
  /\b([A-Z][A-Z0-9_]*(?:_KEY|_SECRET|_TOKEN|_PASSWORD)\s*[:=]\s*)([^\s]+)/g;
const LABELED_CREDENTIAL =
  /\b((?:(spaces|digitalocean|aws|s3|access|secret|api|private|ssh|root|admin|db|database|do)\s+)?(key|secret|token|password|passwd|pwd|pass|pin)\s*[:=]\s*)([^\s]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}/gi;
const OPENAI_KEY = /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g;
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g;
const SLACK_TOKEN = /\bxox[a-z]-[A-Za-z0-9-]{10,}\b/gi;
const ACCESS_KEY = /\b(?:AKIA|DO00)[A-Z0-9]{16}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const HIGH_ENTROPY_TOKEN = /[A-Za-z0-9/+=_-]{32,}/g;

function splitTrailingSentencePunctuation(value: string): {
  credential: string;
  punctuation: string;
} {
  const punctuation = value.match(/[.,;:!?)]*$/)?.[0] ?? "";
  return {
    credential: punctuation ? value.slice(0, -punctuation.length) : value,
    punctuation,
  };
}

function redactLabeledCredentials(text: string): string {
  return text.replace(/^.*$/gm, (line) => {
    let redacted = line.replace(
      UPPER_SNAKE_CREDENTIAL,
      (match, label: string, value: string) => {
        if (
          value.startsWith("[") ||
          value.includes(HIDDEN_CREDENTIAL) ||
          value.includes("\uE000")
        ) {
          return match;
        }
        const { credential, punctuation } =
          splitTrailingSentencePunctuation(value);
        rememberCredential(credential);
        return `${label}${HIDDEN_CREDENTIAL}${punctuation}`;
      },
    );
    redacted = redacted.replace(
      LABELED_CREDENTIAL,
      (
        _match,
        label: string,
        _prefix: string | undefined,
        _name: string,
        value: string,
      ) => {
        if (
          value.startsWith("[") ||
          value.includes(HIDDEN_CREDENTIAL) ||
          value.includes("\uE000")
        ) {
          return _match;
        }
        const { credential, punctuation } =
          splitTrailingSentencePunctuation(value);
        rememberCredential(credential);
        return `${label}${HIDDEN_CREDENTIAL}${punctuation}`;
      },
    );
    return redacted;
  });
}

function isCommandOrPath(value: string): boolean {
  return /^(?:[-/.~]|https?:\/\/|ssh\b|sshpass\b|sudo\b|cd\b|scp\b|sftp\b|curl\b|wget\b|export\b|set\b)/i.test(
    value,
  );
}

function isLikelySshPassword(value: string): boolean {
  const normalized = value.replace(/[.,;:)]*$/, "");
  return normalized.length >= 6 && /\d|[!@#$%^&*+_=<>{}|~]/.test(normalized);
}

function redactSshFollowingPasswords(text: string): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const ssh = line.match(
      /\bssh\b[^\r\n]*?\b[A-Za-z0-9._-]+@[A-Za-z0-9.[\]:_-]+/i,
    );
    if (!ssh || ssh.index == null) continue;
    const end = ssh.index + ssh[0].length;
    const remainder = line.slice(end);
    const sameLineToken = remainder.trim().split(/\s+/)[0] ?? "";
    if (
      sameLineToken &&
      !isCommandOrPath(sameLineToken) &&
      isLikelySshPassword(sameLineToken)
    ) {
      rememberCredential(sameLineToken);
      lines[index] =
        line.slice(0, end) +
        remainder.replace(sameLineToken, HIDDEN_CREDENTIAL);
      continue;
    }
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = (lines[next] ?? "").trim();
      if (!candidate) continue;
      const token = candidate.split(/\s+/)[0] ?? "";
      if (token && !isCommandOrPath(token) && isLikelySshPassword(token)) {
        rememberCredential(token);
        lines[next] = (lines[next] ?? "").replace(token, HIDDEN_CREDENTIAL);
      }
      break;
    }
  }
  return lines.join(newline);
}

function plausibleHost(value: string): boolean {
  const host = value.replace(/:\d+$/, "");
  return (
    /^localhost$/i.test(host) ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    /^\[[0-9a-f:]+\]$/i.test(host) ||
    /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(host)
  );
}

function redactUserInfoCredentials(text: string): string {
  return text.replace(
    USERINFO_TOKEN,
    (match, prefix: string, token: string) => {
      if (
        !token.includes("@") ||
        token.startsWith("//") ||
        token.includes("\uE000")
      ) {
        return match;
      }
      const punctuation = token.match(/[.,;:!?")']+$/)?.[0] ?? "";
      const coreToken = punctuation
        ? token.slice(0, -punctuation.length)
        : token;
      const slash = coreToken.indexOf("/");
      const authority = slash >= 0 ? coreToken.slice(0, slash) : coreToken;
      const path = slash >= 0 ? coreToken.slice(slash) : "";
      const separators = [...authority.matchAll(/@/g)]
        .map((entry) => entry.index ?? -1)
        .filter((index) => index >= 0);
      let hostAt = -1;
      for (let index = separators.length - 1; index >= 0; index -= 1) {
        const separator = separators[index]!;
        if (plausibleHost(authority.slice(separator + 1))) {
          hostAt = separator;
          break;
        }
      }
      const credential = hostAt >= 0 ? authority.slice(0, hostAt) : authority;
      const host = hostAt >= 0 ? authority.slice(hostAt) : "";
      rememberCredential(credential);
      return `${prefix}${HIDDEN_CREDENTIAL}${host}${path}${punctuation}`;
    },
  );
}

function redactHighEntropyTokens(text: string): string {
  const urlRanges = [...text.matchAll(/\b(?:https?|ftp):\/\/[^\s<>"']+/gi)].map(
    (match) => [match.index ?? 0, (match.index ?? 0) + match[0].length],
  );
  return text.replace(HIGH_ENTROPY_TOKEN, (token, offset: number) => {
    if (urlRanges.some(([start, end]) => offset >= start && offset < end)) {
      return token;
    }
    if (
      /^[0-9a-f]{32,64}$/i.test(token) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        token,
      )
    ) {
      return token;
    }
    const mixedCase = /[a-z]/.test(token) && /[A-Z]/.test(token);
    const hasEntropyMarker = /\d|[+/]/.test(token);
    if (mixedCase && hasEntropyMarker) {
      rememberCredential(token);
      return HIDDEN_CREDENTIAL;
    }
    return token;
  });
}

function learnedCredentialPatterns(): string[] {
  const known = [...(credentialScope.getStore()?.credentials ?? [])].sort(
    (a, b) => b.length - a.length,
  );
  const values = new Set<string>();
  for (const value of known) {
    if (value.length >= 6) values.add(value);
    for (const piece of value.split(/[@<>"'=:;/\\\s]+/)) {
      if (
        piece.length >= 6 &&
        (/\d|[+_=-]/.test(piece) ||
          (/[a-z]/.test(piece) && /[A-Z]/.test(piece)) ||
          piece.length >= 12) &&
        !/^(?:hidden|credential)$/i.test(piece)
      ) {
        values.add(piece);
      }
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

function redactKnownCredentialValues(text: string): string {
  const known = learnedCredentialPatterns();
  let redacted = text;
  for (const value of known) {
    redacted = redacted.split(value).join(HIDDEN_CREDENTIAL);
  }
  return redacted;
}

const IPV4_CANDIDATE =
  /(?<![A-Za-z0-9_.])(?:\d{1,3}\.){3}\d{1,3}(?![A-Za-z0-9_]|\.\d)/g;
const IPV6_CANDIDATE =
  /(?<![A-Za-z0-9_:.])(?:\[[0-9A-Fa-f:.]+(?:%[A-Za-z0-9_~-](?:[A-Za-z0-9._~-]*[A-Za-z0-9_~-])?)?\]|[0-9A-Fa-f:][0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*(?:%[A-Za-z0-9_~-](?:[A-Za-z0-9._~-]*[A-Za-z0-9_~-])?)?)(?![A-Za-z0-9_:]|\.\d)/g;
const SPLIT_IP_CANDIDATE =
  /(?<![A-Za-z0-9_.])\d{1,3}\.\s+\d{1,3}\.(?:\s+\d{1,3}\.){0,2}(?!\d)/g;
const HOST_LABEL = /\b(?:ip|host(?:name)?|server|ssh|db|database|port)\b/i;
const HOSTNAME_PATTERN =
  "(?:localhost|[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)";
const HOST_VALUE_PATTERN = `(?:${HOSTNAME_PATTERN}|[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)`;
const SAFE_LINK_HOSTS = new Set([
  "psychiatry.med.miami.edu",
  "smartersoftware.io",
  "secure.touchnet.net",
  "dadeschools.net",
  "eappraisal.miami.edu",
]);

function validIpv4(value: string): boolean {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => {
      if (!/^\d{1,3}$/.test(octet)) return false;
      const number = Number(octet);
      return number >= 0 && number <= 255;
    })
  );
}

function isProtectedAddressContext(text: string, offset: number): boolean {
  const prefix = text.slice(Math.max(0, offset - 64), offset);
  return /\b(?:v|ver(?:sion)?|release|build|date|time|phone|tel(?:ephone)?|price|cost|amount|total|masked\s*(?:id|identifier))\s*(?:[:=#-]\s*)?$/i.test(
    prefix,
  );
}

function ipv6Value(candidate: string): {
  value: string;
  punctuation: string;
} | null {
  const punctuation = candidate.startsWith("[")
    ? ""
    : (candidate.match(/\.+$/)?.[0] ?? "");
  const core = punctuation
    ? candidate.slice(0, -punctuation.length)
    : candidate;
  const unwrapped =
    core.startsWith("[") && core.endsWith("]") ? core.slice(1, -1) : core;
  const withoutZone = unwrapped.replace(/%[A-Za-z0-9._~-]+$/, "");
  return isIP(withoutZone) === 6 ? { value: unwrapped, punctuation } : null;
}

function splitIpIsValid(value: string): boolean {
  const octets = value.match(/\d{1,3}/g) ?? [];
  return (
    octets.length >= 2 &&
    octets.every((octet) => Number(octet) >= 0 && Number(octet) <= 255)
  );
}

function nearHostLabel(text: string, offset: number, length: number): boolean {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const nextNewline = text.indexOf("\n", offset + length);
  const lineEnd = nextNewline < 0 ? text.length : nextNewline;
  const before = text.slice(Math.max(lineStart, offset - 64), offset);
  const after = text.slice(
    offset + length,
    Math.min(lineEnd, offset + length + 32),
  );
  return HOST_LABEL.test(before) || HOST_LABEL.test(after);
}

function isLocalHostname(host: string): boolean {
  return /^localhost$/i.test(host) || /\.(?:internal|local)$/i.test(host);
}

function isSafeLinkHost(host: string): boolean {
  return SAFE_LINK_HOSTS.has(host.toLowerCase());
}

function isHostname(host: string): boolean {
  if (host.includes("[") || host.includes("\uE000")) return false;
  if (isIP(host)) return false;
  if (/^\d+(?:\.\d+)+$/.test(host)) return false;
  return new RegExp(`^${HOST_VALUE_PATTERN}$`, "i").test(host);
}

function redactCredentialAtHosts(text: string): string {
  const credentialAtHost = new RegExp(
    `((?:\\[hidden credential\\]|\uE000RX+\uE001)@)(${HOST_VALUE_PATTERN})`,
    "gi",
  );
  return text.replace(
    credentialAtHost,
    (match: string, prefix: string, host: string) => {
      if (!isHostname(host) || isSafeLinkHost(host)) return match;
      rememberAddress(host);
      return `${prefix}${HIDDEN_ADDRESS}`;
    },
  );
}

function webUrlRanges(text: string): Array<[number, number]> {
  return [...text.matchAll(/\b(?:https?|ftp):\/\/[^\s<>"']+/gi)].map(
    (match) => [match.index ?? 0, (match.index ?? 0) + match[0].length],
  );
}

function inRanges(offset: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

function redactFullIpAddresses(text: string): {
  text: string;
  found: boolean;
} {
  let found = false;
  let redacted = text.replace(
    IPV6_CANDIDATE,
    (candidate: string, offset: number, source: string) => {
      const parsed = ipv6Value(candidate);
      if (!parsed || isProtectedAddressContext(source, offset)) {
        return candidate;
      }
      found = true;
      rememberAddress(parsed.value);
      return `${HIDDEN_ADDRESS}${parsed.punctuation}`;
    },
  );
  redacted = redacted.replace(
    IPV4_CANDIDATE,
    (value: string, offset: number, source: string) => {
      if (!validIpv4(value) || isProtectedAddressContext(source, offset)) {
        return value;
      }
      found = true;
      rememberAddress(value);
      return HIDDEN_ADDRESS;
    },
  );
  return { text: redacted, found };
}

function redactSplitIpAddresses(text: string, hasFullIp: boolean): string {
  return text.replace(
    SPLIT_IP_CANDIDATE,
    (value: string, offset: number, source: string) => {
      if (
        !splitIpIsValid(value) ||
        (!hasFullIp && !nearHostLabel(source, offset, value.length)) ||
        isProtectedAddressContext(source, offset)
      ) {
        return value;
      }
      rememberAddress(value);
      return HIDDEN_ADDRESS;
    },
  );
}

function redactConnectionStringHosts(text: string): string {
  const connectionHost = new RegExp(
    `\\b([A-Za-z][A-Za-z0-9+.-]*:\\/\\/(?:[^@\\s/?#]*@)?)(${HOST_VALUE_PATTERN})(?=:\\d+\\b|[/?#\\s]|$)`,
    "gi",
  );
  return text.replace(
    connectionHost,
    (match: string, prefix: string, host: string) => {
      const scheme = prefix.slice(0, prefix.indexOf(":")).toLowerCase();
      if (["http", "https", "ftp"].includes(scheme) && !isLocalHostname(host)) {
        return match;
      }
      if (!isHostname(host) || isSafeLinkHost(host)) return match;
      rememberAddress(host);
      return `${prefix}${HIDDEN_ADDRESS}`;
    },
  );
}

function isEmailContext(text: string, atOffset: number): boolean {
  const prefix = text.slice(Math.max(0, atOffset - 40), atOffset);
  return /\b(?:contact|email|e-mail|mailto|from|to|cc|reply(?:-to)?)\s*(?::\s*|\s+)[A-Za-z0-9._-]*$/i.test(
    prefix,
  );
}

function redactUserAtHosts(text: string): string {
  const userAtHost = new RegExp(
    `\\b([A-Za-z0-9._-]+@)(${HOST_VALUE_PATTERN})`,
    "gi",
  );
  const urlRanges = webUrlRanges(text);
  return text.replace(
    userAtHost,
    (
      match: string,
      user: string,
      host: string,
      offset: number,
      source: string,
    ) => {
      const atOffset = offset + user.length - 1;
      if (
        !isHostname(host) ||
        isSafeLinkHost(host) ||
        (inRanges(offset, urlRanges) && !isLocalHostname(host)) ||
        (isEmailContext(source, atOffset) && !isLocalHostname(host))
      ) {
        return match;
      }
      rememberAddress(host);
      return `${user}${HIDDEN_ADDRESS}`;
    },
  );
}

function redactHostPorts(text: string): string {
  const hostPort = new RegExp(`\\b(${HOST_VALUE_PATTERN}):(\\d{1,5})\\b`, "gi");
  const urlRanges = webUrlRanges(text);
  return text.replace(
    hostPort,
    (match: string, host: string, port: string, offset: number) => {
      const previous = text[offset - 1] ?? "";
      const sourceFilePath =
        (previous === "/" || previous === "\\") &&
        /\.(?:[cm]?[jt]sx?|json|map|md)$/i.test(host);
      if (
        !isHostname(host) ||
        Number(port) > 65_535 ||
        isSafeLinkHost(host) ||
        sourceFilePath ||
        (inRanges(offset, urlRanges) && !isLocalHostname(host))
      ) {
        return match;
      }
      rememberAddress(host);
      return `${HIDDEN_ADDRESS}:${port}`;
    },
  );
}

function redactLabeledHosts(text: string): string {
  const labeledHost = new RegExp(
    `\\b((?:(?:ssh|db|database)\\s+)?(?:ip|host(?:name)?|server|ssh|db|database|port)\\s*(?:(?:host|server|address)\\s*)?(?:is|[:=])\\s*)(${HOST_VALUE_PATTERN})`,
    "gi",
  );
  const urlRanges = webUrlRanges(text);
  return text.replace(
    labeledHost,
    (
      match: string,
      label: string,
      host: string,
      offset: number,
      source: string,
    ) => {
      const hostOffset = offset + label.length;
      const following = source.slice(
        hostOffset + host.length,
        hostOffset + host.length + 3,
      );
      if (
        !isHostname(host) ||
        isSafeLinkHost(host) ||
        following.startsWith("@") ||
        following.startsWith("://") ||
        (inRanges(hostOffset, urlRanges) && !isLocalHostname(host))
      ) {
        return match;
      }
      rememberAddress(host);
      return `${label}${HIDDEN_ADDRESS}`;
    },
  );
}

function redactLocalHosts(text: string): string {
  const localHost = new RegExp(
    `\\b(${HOSTNAME_PATTERN})(?=:\\d+\\b|[/?#\\s.,;:!?)]|$)`,
    "gi",
  );
  return text.replace(localHost, (host: string) => {
    if (!isLocalHostname(host) || isSafeLinkHost(host)) return host;
    rememberAddress(host);
    return HIDDEN_ADDRESS;
  });
}

function redactRememberedIpFragments(text: string): string {
  const prefixes = new Set<string>();
  for (const value of credentialScope.getStore()?.addresses ?? []) {
    if (!validIpv4(value)) continue;
    const [first, second, third] = value.split(".");
    prefixes.add(
      `${first}[ \\t]*\\.[ \\t]*${second}[ \\t]*\\.(?:[ \\t]*${third}[ \\t]*\\.)?`,
    );
  }
  let redacted = text;
  for (const prefix of prefixes) {
    const urlRanges = webUrlRanges(redacted);
    redacted = redacted.replace(
      new RegExp(`(?<![A-Za-z0-9_.])${prefix}(?![A-Za-z0-9])`, "g"),
      (match: string, offset: number, source: string) => {
        if (
          isProtectedAddressContext(source, offset) ||
          inRanges(offset, urlRanges)
        ) {
          return match;
        }
        return HIDDEN_ADDRESS;
      },
    );
  }
  return redacted;
}

function redactKnownAddressValues(text: string): string {
  const known = [...(credentialScope.getStore()?.addresses ?? [])].sort(
    (a, b) => b.length - a.length,
  );
  let redacted = text;
  for (const value of known) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hostname = isHostname(value);
    const urlRanges = webUrlRanges(redacted);
    redacted = redacted.replace(
      new RegExp(
        `(?<![A-Za-z0-9_.:%-])${escaped}(?![A-Za-z0-9_:%-]|\\.[A-Za-z0-9])`,
        "gi",
      ),
      (match: string, offset: number, source: string) => {
        if (
          isProtectedAddressContext(source, offset) ||
          isSafeLinkHost(value) ||
          (hostname && inRanges(offset, urlRanges) && !isLocalHostname(value))
        ) {
          return match;
        }
        return HIDDEN_ADDRESS;
      },
    );
  }
  return redacted;
}

function redactNetworkAddresses(text: string): string {
  const known = redactRememberedIpFragments(redactKnownAddressValues(text));
  const full = redactFullIpAddresses(known);
  const split = redactSplitIpAddresses(full.text, full.found);
  return redactRememberedIpFragments(
    redactKnownAddressValues(
      redactLocalHosts(
        redactLabeledHosts(
          redactHostPorts(
            redactUserAtHosts(
              redactConnectionStringHosts(redactCredentialAtHosts(split)),
            ),
          ),
        ),
      ),
    ),
  );
}

function collapseCredentialPlaceholders(text: string): string {
  return text
    .replace(/\[+\s*hidden credential\s*\]+/gi, HIDDEN_CREDENTIAL)
    .replace(
      /\[hidden credential\](?:\s*\[hidden credential\])+/g,
      HIDDEN_CREDENTIAL,
    )
    .replace(/\[hidden credential\](?:\s*credential\])+/g, HIDDEN_CREDENTIAL);
}

function collapseAddressPlaceholders(text: string): string {
  return text
    .replace(/\[+\s*hidden address\s*\]+/gi, HIDDEN_ADDRESS)
    .replace(/\[hidden address\](?:\s*\[hidden address\])+/g, HIDDEN_ADDRESS)
    .replace(/\[hidden address\](?:\s*address\])+/g, HIDDEN_ADDRESS);
}

function collapseSensitivePlaceholders(text: string): string {
  return collapseAddressPlaceholders(collapseCredentialPlaceholders(text));
}

function protectSensitivePlaceholders(text: string): {
  protectedText: string;
  restore: (value: string) => string;
} {
  const placeholders: Array<{ token: string; value: string }> = [];
  const protectedText = collapseSensitivePlaceholders(text).replace(
    /\[hidden (?:credential|address)\]/g,
    (value) => {
      const token = `\uE000R${"X".repeat(placeholders.length + 1)}\uE001`;
      placeholders.push({ token, value });
      return token;
    },
  );
  return {
    protectedText,
    restore: (value) => {
      let restored = value;
      for (const placeholder of placeholders) {
        restored = restored.split(placeholder.token).join(placeholder.value);
      }
      return collapseSensitivePlaceholders(restored);
    },
  };
}

export function redactTtsCredentials(text: string): string {
  const redacted = redactCredentials(text);
  const urlRanges = [
    ...redacted.matchAll(/\b(?:https?|ftp):\/\/[^\s<>"']+/gi),
  ].map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length]);
  return collapseSensitivePlaceholders(
    redacted.replace(/[A-Za-z0-9/+=_-]{12,}/g, (token, offset: number) => {
      if (urlRanges.some(([start, end]) => offset >= start && offset < end)) {
        return token;
      }
      return /[a-z]/.test(token) && /[A-Z]/.test(token) && /\d/.test(token)
        ? HIDDEN_CREDENTIAL
        : token;
    }),
  );
}

export function redactCredentials(text: string): string {
  if (!text) return text;
  const { protectedText, restore } = protectSensitivePlaceholders(text);
  const scoped = redactKnownCredentialValues(protectedText);
  const known = scoped
    .replace(PRIVATE_KEY_BLOCK, (value) => {
      rememberCredential(value);
      return HIDDEN_CREDENTIAL;
    })
    .replace(SSHPASS_PASSWORD, (_match, prefix: string, value: string) => {
      const { credential, punctuation } =
        splitTrailingSentencePunctuation(value);
      rememberCredential(credential);
      return `${prefix}${HIDDEN_CREDENTIAL}${punctuation}`;
    })
    .replace(INLINE_PASSWORD, (match, prefix: string, value: string) => {
      if (
        value.startsWith("[") ||
        value.includes(HIDDEN_CREDENTIAL) ||
        value.includes("\uE000")
      ) {
        return match;
      }
      rememberCredential(value);
      return `${prefix}${HIDDEN_CREDENTIAL}`;
    })
    .replace(BEARER_TOKEN, (value) => {
      rememberCredential(value.replace(/^Bearer\s+/i, ""));
      return HIDDEN_CREDENTIAL;
    })
    .replace(OPENAI_KEY, (value) => {
      rememberCredential(value);
      return HIDDEN_CREDENTIAL;
    })
    .replace(GITHUB_TOKEN, (value) => {
      rememberCredential(value);
      return HIDDEN_CREDENTIAL;
    })
    .replace(SLACK_TOKEN, (value) => {
      rememberCredential(value);
      return HIDDEN_CREDENTIAL;
    })
    .replace(ACCESS_KEY, (value) => {
      rememberCredential(value);
      return HIDDEN_CREDENTIAL;
    })
    .replace(JWT, (value) => {
      rememberCredential(value);
      return HIDDEN_CREDENTIAL;
    });
  const firstPass = redactHighEntropyTokens(
    redactSshFollowingPasswords(
      redactLabeledCredentials(redactUserInfoCredentials(known)),
    ),
  );
  return restore(
    redactNetworkAddresses(redactKnownCredentialValues(firstPass)),
  );
}

function redactError(error: Error): Error {
  const redacted = new Error(redactCredentials(error.message));
  redacted.name = error.name;
  if (error.stack) redacted.stack = redactCredentials(error.stack);
  for (const [key, value] of Object.entries(error)) {
    (redacted as unknown as Record<string, unknown>)[key] =
      redactSensitiveValue(value);
  }
  return redacted;
}

export function redactSensitiveValue<T>(
  value: T,
  seen = new WeakMap<object, unknown>(),
): T {
  if (typeof value === "string") return redactCredentials(value) as T;
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Error) return redactError(value) as T;
  if (
    value instanceof Date ||
    value instanceof URL ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer
  ) {
    return value;
  }
  const existing = seen.get(value);
  if (existing) return existing as T;
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(value, output);
    for (const entry of value) output.push(redactSensitiveValue(entry, seen));
    return output as T;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const output: Record<string, unknown> = {};
  seen.set(value, output);
  for (const [key, entry] of Object.entries(value)) {
    output[key] = redactSensitiveValue(entry, seen);
  }
  return output as T;
}

export function isCredentialRequest(text: string): boolean {
  return /\b(?:password|passcode|pwd|credential|private\s+key|api\s+key|access\s+key|secret\s+key|token|connection\s+string)\b/i.test(
    text,
  );
}

export function credentialReferenceAnswer(title: string): string {
  return `That credential is stored in your note ${redactCredentials(title)}. Open the note or say “show me” to view it.`;
}
