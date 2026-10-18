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
 * Environment-backed feature flag. Non-AI flags retain the historical
 * default-on behavior; known paid/AI flags above default off.
 */
export function isEnabled(
  name: string,
  defaultEnabled = !DEFAULT_OFF_FLAGS.has(name),
): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw == null || raw === "") return defaultEnabled;
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}
