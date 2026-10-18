export const HIDDEN_CREDENTIAL = "[hidden credential]";

const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/gi;
const PASSWORD_LINE =
  /^(\s*(?:(?:ssh|database|db)\s+)?(?:password|pass|pwd)\s*[:=]\s*)(.+)$/gim;
const INLINE_PASSWORD =
  /\b((?:(?:ssh|database|db)\s+)?(?:password|pass|pwd)\s*(?:is|[:=])\s*)([^\s,;]+)/gi;
const LABELED_SECRET =
  /\b((?:(?:aws|spaces|digitalocean|do)\s+)?(?:secret(?:\s+access)?\s+key|api[\s_-]*key|access[\s_-]*token|auth[\s_-]*token|refresh[\s_-]*token|token)\s*[:=]\s*)(["']?)([A-Za-z0-9_./+=-]{8,})(\2)/gi;
const POSTGRES_PASSWORD =
  /\b(postgres(?:ql)?:\/\/[^:/@\s]+:)([^@\s]+)(@[^/\s?#]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}/gi;
const OPENAI_KEY = /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g;
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g;
const SLACK_TOKEN = /\bxox[a-z]-[A-Za-z0-9-]{10,}\b/gi;
const ACCESS_KEY = /\b(?:AKIA|DO00)[A-Z0-9]{16}\b/g;
const JWT =
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

export function redactCredentials(text: string): string {
  if (!text) return text;
  return text
    .replace(PRIVATE_KEY_BLOCK, HIDDEN_CREDENTIAL)
    .replace(POSTGRES_PASSWORD, `$1${HIDDEN_CREDENTIAL}$3`)
    .replace(PASSWORD_LINE, `$1${HIDDEN_CREDENTIAL}`)
    .replace(INLINE_PASSWORD, `$1${HIDDEN_CREDENTIAL}`)
    .replace(LABELED_SECRET, `$1${HIDDEN_CREDENTIAL}`)
    .replace(BEARER_TOKEN, HIDDEN_CREDENTIAL)
    .replace(OPENAI_KEY, HIDDEN_CREDENTIAL)
    .replace(GITHUB_TOKEN, HIDDEN_CREDENTIAL)
    .replace(SLACK_TOKEN, HIDDEN_CREDENTIAL)
    .replace(ACCESS_KEY, HIDDEN_CREDENTIAL)
    .replace(JWT, HIDDEN_CREDENTIAL);
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
