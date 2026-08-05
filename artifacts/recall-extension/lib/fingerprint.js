/**
 * Local fingerprinting / dedupe for automatic browser captures.
 * Does not store message bodies — only short hashes + timestamps.
 */

export const FINGERPRINT_HISTORY_KEY = "recallCaptureFingerprints";
export const MAX_FINGERPRINTS = 200;
/** Keep fingerprints for a week so tab refreshes and re-opens do not re-send. */
export const FINGERPRINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Normalize text before hashing so whitespace / case churn does not create
 * duplicate captures of the same opened message.
 * @param {string | null | undefined} text
 */
export function normalizeForFingerprint(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

/**
 * Stable, non-cryptographic hash for local dedupe. Fast and good enough for
 * collision resistance across a few hundred recent captures.
 * @param {string} input
 */
export function hashString(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * @param {{
 *   source: string;
 *   url?: string | null;
 *   subjectOrChat?: string | null;
 *   sender?: string | null;
 *   messageText?: string | null;
 * }} parts
 */
export function buildFingerprint(parts) {
  const joined = [
    normalizeForFingerprint(parts.source),
    normalizeForFingerprint(parts.url),
    normalizeForFingerprint(parts.subjectOrChat),
    normalizeForFingerprint(parts.sender),
    normalizeForFingerprint(parts.messageText),
  ].join("|");
  return hashString(joined);
}

/**
 * Drop expired entries and enforce the history cap (newest kept).
 * @param {Array<{ fingerprint: string; at: number }>} history
 * @param {number} [now]
 */
export function pruneFingerprintHistory(history, now = Date.now()) {
  const list = Array.isArray(history) ? history : [];
  const fresh = list.filter(
    (row) =>
      row &&
      typeof row.fingerprint === "string" &&
      typeof row.at === "number" &&
      now - row.at < FINGERPRINT_TTL_MS,
  );
  // De-dupe by fingerprint, keeping the newest timestamp.
  const byFp = new Map();
  for (const row of fresh) {
    const prev = byFp.get(row.fingerprint);
    if (!prev || row.at > prev.at) byFp.set(row.fingerprint, row);
  }
  return [...byFp.values()]
    .sort((a, b) => a.at - b.at)
    .slice(-MAX_FINGERPRINTS);
}

/**
 * @param {Array<{ fingerprint: string; at: number }>} history
 * @param {string} fingerprint
 * @param {number} [now]
 */
export function hasRecentFingerprint(history, fingerprint, now = Date.now()) {
  const pruned = pruneFingerprintHistory(history, now);
  return pruned.some((row) => row.fingerprint === fingerprint);
}

/**
 * @param {Array<{ fingerprint: string; at: number }>} history
 * @param {string} fingerprint
 * @param {number} [now]
 */
export function rememberFingerprint(history, fingerprint, now = Date.now()) {
  return pruneFingerprintHistory(
    [...(Array.isArray(history) ? history : []), { fingerprint, at: now }],
    now,
  );
}
