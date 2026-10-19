import { AsyncLocalStorage } from "node:async_hooks";

export const HIDDEN_CREDENTIAL = "[hidden credential]";

const credentialScope = new AsyncLocalStorage<Set<string>>();

export function withCredentialRedactionScope<T>(
  operation: () => T,
  seed: Iterable<string> = [],
): T {
  const existing = credentialScope.getStore();
  if (existing) {
    for (const value of seed) rememberCredential(value);
    return operation();
  }
  return credentialScope.run(new Set<string>(seed), operation);
}

export function learnedCredentialValues(): string[] {
  return [...(credentialScope.getStore() ?? [])];
}

function rememberCredential(value: string): void {
  const normalized = value.replace(/^["']|["']$/g, "");
  if (
    normalized.length >= 6 &&
    !normalized.startsWith("[") &&
    !normalized.includes(HIDDEN_CREDENTIAL) &&
    !normalized.includes("hidden credential")
  ) {
    credentialScope.getStore()?.add(normalized);
  }
}

const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/gi;
const INLINE_PASSWORD =
  /\b((?:(?:ssh|database|db)\s+)?(?:password|passwd|pass|pwd|pin)\s*(?:is|[:=])\s*)([^\s,;]+)/gi;
const USERINFO_TOKEN =
  /\b((?:[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9._-]+:)|(?:[A-Za-z0-9._-]+:(?!\/\/)))([^\s]+)/gi;
const SSHPASS_PASSWORD =
  /\b(sshpass\s+-p\s+)("[^"]*"|'[^']*'|\S+)/gi;
const UPPER_SNAKE_CREDENTIAL =
  /\b([A-Z][A-Z0-9_]*(?:_KEY|_SECRET|_TOKEN|_PASSWORD)\s*[:=]\s*)([^\s]+)/g;
const LABELED_CREDENTIAL =
  /\b((?:(spaces|digitalocean|aws|s3|access|secret|api|private|ssh|root|admin|db|database|do)\s+)?(key|secret|token|password|passwd|pwd|pass|pin)\s*[:=]\s*)([^\s]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}/gi;
const OPENAI_KEY = /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g;
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g;
const SLACK_TOKEN = /\bxox[a-z]-[A-Za-z0-9-]{10,}\b/gi;
const ACCESS_KEY = /\b(?:AKIA|DO00)[A-Z0-9]{16}\b/g;
const JWT =
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const HIGH_ENTROPY_TOKEN = /[A-Za-z0-9/+=_-]{32,}/g;

function redactLabeledCredentials(text: string): string {
  return text.replace(/^.*$/gm, (line) => {
    let redacted = line.replace(
      UPPER_SNAKE_CREDENTIAL,
      (match, label: string, value: string) => {
        if (value.startsWith("[") || value.includes(HIDDEN_CREDENTIAL)) {
          return match;
        }
        rememberCredential(value);
        return `${label}${HIDDEN_CREDENTIAL}`;
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
        if (value.startsWith("[") || value.includes(HIDDEN_CREDENTIAL)) {
          return _match;
        }
        rememberCredential(value);
        return `${label}${HIDDEN_CREDENTIAL}`;
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
    if (sameLineToken && !isCommandOrPath(sameLineToken)) {
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
      if (token && !isCommandOrPath(token)) {
        rememberCredential(token);
        lines[next] = (lines[next] ?? "").replace(
          token,
          HIDDEN_CREDENTIAL,
        );
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
    host.includes(".")
  );
}

function redactUserInfoCredentials(text: string): string {
  return text.replace(
    USERINFO_TOKEN,
    (match, prefix: string, token: string) => {
      if (!token.includes("@") || token.startsWith("//")) return match;
      const slash = token.indexOf("/");
      const authority = slash >= 0 ? token.slice(0, slash) : token;
      const path = slash >= 0 ? token.slice(slash) : "";
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
      const credential =
        hostAt >= 0 ? authority.slice(0, hostAt) : authority;
      const host = hostAt >= 0 ? authority.slice(hostAt) : "";
      rememberCredential(credential);
      return `${prefix}${HIDDEN_CREDENTIAL}${host}${path}`;
    },
  );
}

function redactHighEntropyTokens(text: string): string {
  const urlRanges = [
    ...text.matchAll(/\b(?:https?|ftp):\/\/[^\s<>"']+/gi),
  ].map((match) => [
    match.index ?? 0,
    (match.index ?? 0) + match[0].length,
  ]);
  return text.replace(HIGH_ENTROPY_TOKEN, (token, offset: number) => {
    if (
      urlRanges.some(([start, end]) => offset >= start && offset < end)
    ) {
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

function redactKnownCredentialValues(text: string): string {
  const known = [...(credentialScope.getStore() ?? [])].sort(
    (a, b) => b.length - a.length,
  );
  let redacted = text;
  for (const value of known) {
    if (value.length >= 6) redacted = redacted.split(value).join(HIDDEN_CREDENTIAL);
  }
  return redacted.replace(
    /[A-Za-z0-9@:/+_=.-]{6,}/g,
    (token) => {
      for (const value of known) {
        const maxLength = Math.min(token.length, value.length);
        for (let length = maxLength; length >= 6; length -= 1) {
          let shared = false;
          for (let start = 0; start + length <= value.length; start += 1) {
            if (token.includes(value.slice(start, start + length))) {
              shared = true;
              break;
            }
          }
          if (shared) return HIDDEN_CREDENTIAL;
        }
      }
      return token;
    },
  );
}

function collapseCredentialPlaceholders(text: string): string {
  return text
    .replace(
      /\[hidden credential\](?:\s*\[hidden credential\])+/g,
      HIDDEN_CREDENTIAL,
    )
    .replace(
      /\[hidden credential\](?:\s*credential\])+/g,
      HIDDEN_CREDENTIAL,
    );
}

export function redactTtsCredentials(text: string): string {
  const redacted = redactCredentials(text);
  const urlRanges = [
    ...redacted.matchAll(/\b(?:https?|ftp):\/\/[^\s<>"']+/gi),
  ].map((match) => [
    match.index ?? 0,
    (match.index ?? 0) + match[0].length,
  ]);
  return collapseCredentialPlaceholders(
    redacted.replace(
      /[A-Za-z0-9/+=_-]{12,}/g,
      (token, offset: number) => {
        if (
          urlRanges.some(([start, end]) => offset >= start && offset < end)
        ) {
          return token;
        }
        return /[a-z]/.test(token) &&
          /[A-Z]/.test(token) &&
          /\d/.test(token)
          ? HIDDEN_CREDENTIAL
          : token;
      },
    ),
  );
}

export function redactCredentials(text: string): string {
  if (!text) return text;
  const scoped = redactKnownCredentialValues(text);
  const known = scoped
    .replace(PRIVATE_KEY_BLOCK, (value) => {
      rememberCredential(value);
      return HIDDEN_CREDENTIAL;
    })
    .replace(SSHPASS_PASSWORD, (_match, prefix: string, value: string) => {
      rememberCredential(value);
      return `${prefix}${HIDDEN_CREDENTIAL}`;
    })
    .replace(INLINE_PASSWORD, (_match, prefix: string, value: string) => {
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
  return collapseCredentialPlaceholders(
    redactKnownCredentialValues(firstPass),
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
