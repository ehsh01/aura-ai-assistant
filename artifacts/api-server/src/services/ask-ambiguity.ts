/**
 * Clarify-first ambiguity detection for Ask.
 * Prefer one clarifying question over inventing a filter that zeros out data.
 */

const DATE_TYPOS: Array<{ re: RegExp; canonical: string }> = [
  { re: /\byeaterday\b/i, canonical: "yesterday" },
  { re: /\byesteday\b/i, canonical: "yesterday" },
  { re: /\byestarday\b/i, canonical: "yesterday" },
  { re: /\btodya\b/i, canonical: "today" },
  { re: /\btodays\b/i, canonical: "today" },
  { re: /\blas\s+week\b/i, canonical: "last week" },
  { re: /\blas\s+month\b/i, canonical: "last month" },
];

/** Repair common spoken/typed date typos before parsing ranges. */
export function repairDateTypos(text: string): {
  text: string;
  repairedFrom: string | null;
  repairedTo: string | null;
} {
  let out = text;
  let repairedFrom: string | null = null;
  let repairedTo: string | null = null;
  for (const { re, canonical } of DATE_TYPOS) {
    if (re.test(out)) {
      const m = out.match(re);
      repairedFrom = m?.[0] ?? null;
      repairedTo = canonical;
      out = out.replace(re, canonical);
    }
  }
  return { text: out, repairedFrom, repairedTo };
}

/** Date-like token that looks intentional but isn't a known phrase. */
const SUSPICIOUS_DATE =
  /\b(yest\w*|tod\w+|las\w+\s+(?:week|month|day)|day\s+before)\b/i;

const KNOWN_DATE =
  /\b(today|yesterday|last\s+week|last\s+month|last\s+year|this\s+week|this\s+month|this\s+year|past\s+\d+\s+days?)\b/i;

export type ClarifyResult = {
  needsClarify: true;
  question: string;
  suggestions: string[];
};

export type AmbiguityResult =
  | { needsClarify: false; normalizedQuestion: string; repairedDate: string | null }
  | ClarifyResult;

/**
 * Detect underspecified / typo date phrasing before fetching sources.
 * Relation-without-person is handled after People resolution in the router.
 */
export function detectAskAmbiguity(question: string): AmbiguityResult {
  const repaired = repairDateTypos(question);
  const normalized = repaired.text;

  if (repaired.repairedTo) {
    return {
      needsClarify: false,
      normalizedQuestion: normalized,
      repairedDate: repaired.repairedTo,
    };
  }

  // Suspicious date-like token that still isn't a known phrase after repair.
  if (SUSPICIOUS_DATE.test(normalized) && !KNOWN_DATE.test(normalized)) {
    const token = normalized.match(SUSPICIOUS_DATE)?.[0] ?? "that date";
    return {
      needsClarify: true,
      question: `I wasn't sure what “${token}” meant as a date. Did you mean yesterday, today, or this week?`,
      suggestions: ["Yesterday", "Today", "This week"],
    };
  }

  return {
    needsClarify: false,
    normalizedQuestion: normalized,
    repairedDate: null,
  };
}
