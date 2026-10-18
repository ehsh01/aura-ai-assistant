/** Shared filler words for keyword scoring and note FTS term extraction. */
export const KEYWORD_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "my",
  "me",
  "i",
  "you",
  "your",
  "find",
  "show",
  "get",
  "where",
  "what",
  "who",
  "when",
  "why",
  "which",
  "how",
  "is",
  "are",
  "was",
  "were",
  "do",
  "does",
  "did",
  "can",
  "could",
  "would",
  "should",
  "please",
  "tell",
  "say",
  "says",
  "said",
  "read",
  "called",
  "titled",
  "give",
  "need",
  "want",
  "know",
  "look",
  "looking",
  "search",
  "about",
  "from",
  "with",
  "have",
  "has",
  "had",
  "for",
  "of",
  "in",
  "on",
  "to",
  "and",
  "or",
  "any",
  "some",
  "that",
  "this",
  "there",
  "here",
  "into",
  "over",
  "just",
  "also",
  "last",
  "recent",
  "note",
  "notes",
  "info",
  "information",
  "content",
  "contents",
  "recall",
]);

/** 17-char VIN or common Porsche/VW WP0… forms found in titles and OCR. */
export function extractVinCandidates(text: string): string[] {
  const matches = text
    .toUpperCase()
    .match(/\b(?:WP0[A-Z0-9]{14}|[A-HJ-NPR-Z0-9]{17})\b/g);
  return matches ? [...new Set(matches)] : [];
}

/** Strip possessives/punctuation and simple plurals so "porsches" matches "porsche". */
export function normalizeKeywordToken(t: string): string {
  let token = t
    .toLowerCase()
    .replace(/^[^\w@]+|[^\w@]+$/g, "")
    .replace(/['']s$/i, "")
    .replace(/['']/g, "");
  if (token.length > 5 && token.endsWith("ing")) {
    token = token.slice(0, -3);
  }
  if (
    token.length > 4 &&
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("us") &&
    !token.endsWith("is")
  ) {
    token = token.slice(0, -1);
  }
  return token;
}

const FREE_RETRIEVAL_ALIASES: Record<string, string> = {
  webpage: "website",
  site: "website",
  hyperlink: "link",
};

/**
 * Deterministic, free query cleanup shared by Ask retrieval paths.
 * It intentionally does not call a model or alter the Explore search endpoint.
 */
export function freeRetrievalTerms(query: string, maxTerms = 12): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9@]+/)
        .map(normalizeKeywordToken)
        .map((term) => FREE_RETRIEVAL_ALIASES[term] ?? term)
        .filter((term) => term.length >= 2 && !KEYWORD_STOP_WORDS.has(term)),
    ),
  ].slice(0, maxTerms);
}

export type FreeTextRelevance = {
  score: number;
  matchedTerms: number;
  allTerms: boolean;
  titleMatches: number;
};

/**
 * Relevance for free retrieval. Title hits count four times body-only hits,
 * complete matches beat the any-word fallback, and a title containing every
 * meaningful query term gets an additional exact-title boost.
 */
export function freeTextRelevance(
  query: string,
  title: string,
  text: string,
): FreeTextRelevance {
  const terms = freeRetrievalTerms(query);
  if (terms.length === 0) {
    return { score: 0, matchedTerms: 0, allTerms: false, titleMatches: 0 };
  }
  const normalizedTitle = title.toLowerCase();
  const normalizedText = text.toLowerCase();
  let titleMatches = 0;
  let bodyMatches = 0;
  for (const term of terms) {
    if (normalizedTitle.includes(term)) titleMatches += 1;
    else if (normalizedText.includes(term)) bodyMatches += 1;
  }
  const matchedTerms = titleMatches + bodyMatches;
  if (matchedTerms === 0) {
    return { score: 0, matchedTerms: 0, allTerms: false, titleMatches: 0 };
  }
  const allTerms = matchedTerms === terms.length;
  const coverage = matchedTerms / terms.length;
  const titleCoverage = titleMatches / terms.length;
  const score =
    coverage +
    titleCoverage * 2 +
    (allTerms ? 1 : 0) +
    (titleMatches === terms.length ? 2 : 0);
  return { score, matchedTerms, allTerms, titleMatches };
}

export function rankFreeTextMatches<T extends { title: string; text: string }>(
  query: string,
  records: T[],
  limit = records.length,
): Array<T & FreeTextRelevance> {
  return records
    .map((record, index) => ({
      record,
      index,
      relevance: freeTextRelevance(query, record.title, record.text),
    }))
    .filter(({ relevance }) => relevance.score > 0)
    .sort(
      (a, b) =>
        Number(b.relevance.allTerms) - Number(a.relevance.allTerms) ||
        b.relevance.score - a.relevance.score ||
        a.index - b.index,
    )
    .slice(0, Math.max(0, limit))
    .map(({ record, relevance }) => ({ ...record, ...relevance }));
}

export function keywordScore(question: string, text: string): number {
  const terms = freeRetrievalTerms(question);
  if (terms.length === 0) return 0;
  const hay = text.toLowerCase();
  const vinHits = extractVinCandidates(text);
  const wantsVin = /\bvin\b/i.test(question);
  return (
    terms.reduce((s, t) => {
      if (t === "vin" && wantsVin && vinHits.length > 0) return s + 1;
      return hay.includes(t) ? s + 1 : s;
    }, 0) / terms.length
  );
}
