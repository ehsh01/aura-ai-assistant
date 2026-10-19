import type { NormalizedSourceRecord } from "./types";

/** Replace unpaired UTF-16 surrogate code units with the Unicode replacement character. */
export function sanitizeUnicodeText(value: string): string {
  let sanitized = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        sanitized += value[index] + value[index + 1];
        index += 1;
      } else {
        sanitized += "\ufffd";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      sanitized += "\ufffd";
    } else {
      sanitized += value[index];
    }
  }
  return sanitized;
}

/** Deep-sanitize strings in JSON-shaped connector metadata. */
export function sanitizeConnectorJson<T>(value: T): T {
  if (typeof value === "string") return sanitizeUnicodeText(value) as T;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeConnectorJson(item)) as T;
  }
  if (
    value &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        sanitizeUnicodeText(key),
        sanitizeConnectorJson(item),
      ]),
    ) as T;
  }
  return value;
}

export function sanitizeNormalizedSourceRecord(
  record: NormalizedSourceRecord,
): NormalizedSourceRecord {
  return sanitizeConnectorJson(record);
}
