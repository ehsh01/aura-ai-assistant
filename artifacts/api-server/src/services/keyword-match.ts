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
  "recall",
]);

/** 17-char VIN or common Porsche/VW WP0… forms found in titles and OCR. */
export function extractVinCandidates(text: string): string[] {
  const matches = text.toUpperCase().match(/\b(?:WP0[A-Z0-9]{14}|[A-HJ-NPR-Z0-9]{17})\b/g);
  return matches ? [...new Set(matches)] : [];
}

/** Strip possessives/punctuation and simple plurals so "porsches" matches "porsche". */
export function normalizeKeywordToken(t: string): string {
  let token = t
    .toLowerCase()
    .replace(/^[^\w@]+|[^\w@]+$/g, "")
    .replace(/['']s$/i, "")
    .replace(/['']/g, "");
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

export function keywordScore(question: string, text: string): number {
  const terms = question
    .toLowerCase()
    .split(/\s+/)
    .map(normalizeKeywordToken)
    .filter((t) => t.length > 2 && !KEYWORD_STOP_WORDS.has(t));
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
