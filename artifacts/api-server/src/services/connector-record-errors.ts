export function databaseErrorCode(error: unknown): string | null {
  let current = error;
  const seen = new Set<object>();
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object" || seen.has(current)) return null;
    seen.add(current);
    if ("code" in current && typeof current.code === "string") {
      return current.code.toUpperCase();
    }
    current =
      "cause" in current
        ? current.cause
        : "originalError" in current
          ? current.originalError
          : null;
  }
  return null;
}

/** Data and integrity errors can be isolated to one connector record. */
export function isSkippableConnectorRecordError(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return Boolean(code && (/^22/.test(code) || /^23/.test(code)));
}

/** Avoid persisting or logging database messages that may echo source content. */
export function safeConnectorErrorMessage(error: unknown): string {
  const code = databaseErrorCode(error);
  if (code) return `Connector sync database error (${code})`;
  return error instanceof Error ? error.message : "Connector sync failed";
}
