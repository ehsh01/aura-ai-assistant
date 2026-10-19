export type OneBoxIntent = "save" | "search";

export type OneBoxDecision = {
  intent: OneBoxIntent;
  reason:
    | "forced-save"
    | "forced-search"
    | "attachment"
    | "save-verb"
    | "search-verb"
    | "bare-url"
    | "question-mark"
    | "question-word"
    | "short"
    | "statement";
  value: string;
};

const SAVE_VERB = /^(?:save|remember|note|keep|add)\b[\s,:-]*/i;
const SEARCH_VERB = /^(?:find|look\s+up|search|show(?:\s+me)?)\b[\s,:-]*/i;
const QUESTION_WORD =
  /^(?:who|what|when|where|why|how|which|is|are|do|does|did|can|could|should|will|was|were|has|have|any)\b/i;
const DOCUMENT_WORD = /\b(?:doc|document|file|pdf|contract|policy|receipt)\b/i;
const GRAPH_SEED_STOPWORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "any",
  "are",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "find",
  "from",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "look",
  "me",
  "my",
  "note",
  "notes",
  "of",
  "on",
  "or",
  "please",
  "recall",
  "search",
  "show",
  "tell",
  "the",
  "there",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
]);

function withoutWakeWord(value: string): string {
  return value
    .trim()
    .replace(/^recall\b[\s,:-]*/i, "")
    .trim();
}

export function isBareUrl(value: string): boolean {
  const text = value.trim();
  if (!/^https?:\/\/\S+$/i.test(text)) return false;
  try {
    const url = new URL(text);
    return Boolean(url.hostname) && !/\s/.test(text);
  } catch {
    return false;
  }
}

/** Deterministic any-word graph seed; never sends a full natural-language question. */
export function graphSeedQuery(value: string): string {
  const terms =
    value
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter(
        (term) =>
          (term.length >= 2 || /^\d+$/.test(term)) &&
          !GRAPH_SEED_STOPWORDS.has(term),
      ) ?? [];
  return [...new Set(terms)].slice(0, 8).join(" ");
}

export function classifyOneBoxInput(input: {
  value: string;
  hasAttachment?: boolean;
  forceSave?: boolean;
  voice?: boolean;
}): OneBoxDecision {
  let value = input.voice ? withoutWakeWord(input.value) : input.value.trim();
  if (input.forceSave) return { intent: "save", reason: "forced-save", value };
  if (value.startsWith("?")) {
    return {
      intent: "search",
      reason: "forced-search",
      value: value.slice(1).trim(),
    };
  }
  if (input.hasAttachment) {
    return { intent: "save", reason: "attachment", value };
  }
  if (SAVE_VERB.test(value)) {
    return {
      intent: "save",
      reason: "save-verb",
      value: value.replace(SAVE_VERB, "").trim(),
    };
  }
  if (SEARCH_VERB.test(value)) {
    return {
      intent: "search",
      reason: "search-verb",
      value: value.replace(SEARCH_VERB, "").trim(),
    };
  }
  if (isBareUrl(value)) {
    return { intent: "save", reason: "bare-url", value };
  }
  if (value.endsWith("?")) {
    return { intent: "search", reason: "question-mark", value };
  }
  if (QUESTION_WORD.test(value)) {
    return { intent: "search", reason: "question-word", value };
  }
  const words = value.match(/\b[\p{L}\p{N}'’-]+\b/gu) ?? [];
  if (words.length <= 5) {
    return { intent: "search", reason: "short", value };
  }
  return { intent: "save", reason: "statement", value };
}

export function isShowMeFollowUp(value: string): boolean {
  const normalized = withoutWakeWord(value)
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .trim();
  return /^(?:show\s+me|show\s+it|let\s+me\s+see)$/.test(normalized);
}

export type VoicePresentation = "fact" | "document" | "cards";

export function voicePresentationFor(input: {
  query: string;
  bestIsDocument: boolean;
  answer?: string;
}): VoicePresentation {
  if (input.bestIsDocument || DOCUMENT_WORD.test(input.query)) {
    return "document";
  }
  const answer = input.answer?.trim() ?? "";
  const factLike =
    /\b\d{1,4}(?:[.,:/-]\d{1,4})*(?:\s*(?:am|pm|%|dollars?|usd|days?|years?))?\b/i.test(
      answer,
    ) ||
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
      answer,
    ) ||
    /\btag(?:ged)?\s+(?:as|is|:)\b/i.test(answer);
  return factLike ? "fact" : "cards";
}

export function queryHasDocumentWords(value: string): boolean {
  return DOCUMENT_WORD.test(value);
}

export function voiceAnswerForSpeech(
  answer: string,
  presentation: VoicePresentation,
): string {
  const clean = answer.trim();
  if (presentation !== "document") return clean;
  const prompt = 'I found the document; say "show me" to open it.';
  if (/\bshow me\b/i.test(clean)) return clean;
  return `${clean.replace(/\s+$/, "")} ${prompt}`.trim();
}
