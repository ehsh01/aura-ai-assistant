/** Paid/AI switches are opt-in. Missing values must never enable spend. */
const DEFAULT_OFF_FLAGS = new Set([
  "RECALL_BACKGROUND_AI_ENABLED",
  "RECALL_ATTACHMENT_OCR_ENABLED",
  "RECALL_AI_DIGESTS_ENABLED",
  "RECALL_EMAIL_AI_SCAN_ENABLED",
  "RECALL_OPENAI_TTS_ENABLED",
  "RECALL_SERVER_TTS_ENABLED",
  "RECALL_SERVER_STT_ENABLED",
  "RECALL_HOME_AI_DIGEST_ENABLED",
  "RECALL_EMBEDDING_WARM_ENABLED",
  "RECALL_EVERNOTE_EMBEDDINGS_ENABLED",
]);

/**
 * Parses conventional environment boolean values. Missing, empty, and
 * unrecognized values return undefined so callers can preserve their default.
 */
export function parseEnvBoolean(value: string | undefined): boolean | undefined {
  const raw = value?.trim().toLowerCase();
  if (raw == null || raw === "") return undefined;
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") {
    return true;
  }
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") {
    return false;
  }
  return undefined;
}

/**
 * Environment-backed feature flag. Non-AI flags retain the historical
 * default-on behavior; known paid/AI flags above default off. A present but
 * unrecognized value remains disabled for compatibility.
 */
export function isEnabled(
  name: string,
  defaultEnabled = !DEFAULT_OFF_FLAGS.has(name),
): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return defaultEnabled;
  return parseEnvBoolean(raw) ?? false;
}
