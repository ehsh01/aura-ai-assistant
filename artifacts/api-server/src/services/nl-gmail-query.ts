import OpenAI from "openai";
import {
  buildGmailPersonQuery,
  cleanMailPersonName,
  extractMailPersonName,
} from "./connectors";

export type PlannedGmailSearch = {
  query: string;
  personName: string | null;
  source: "heuristic" | "ai" | "keywords";
};

const EMAIL_INTENT =
  /\b(email|emails|e-?mails?|gmail|inbox|mail|message|messages|mailbox)\b/i;

const SEARCHY =
  /\b(find|search|look(?:ing)?\s+for|show(?:\s+me)?|any|get|pull|check|locate|fetch)\b/i;

const FILLER =
  /\b(please|okay|ok|hey|can you|could you|would you|i need|i want|help me|for me|in my|my|the|a|an|of|to|and|or|just|really|also)\b/gi;

/**
 * True when the user is asking Ask to find / recall mail (including follow-ups
 * that still mention mail in the combined retrieval question).
 */
export function isEmailSearchIntent(text: string): boolean {
  const q = text.trim();
  if (!q) return false;
  if (EMAIL_INTENT.test(q)) return true;
  // "did nancy email me", "mail from bryant"
  if (/\b(emailed|emailing|mailed|mailing)\b/i.test(q)) return true;
  return false;
}

/** Map common spoken dates into Gmail after:/before: operators. */
export function extractGmailDateConstraint(text: string): string | null {
  const q = text.trim();
  const newer = q.match(/\b(?:last|past)\s+(\d+)\s+days?\b/i);
  if (newer?.[1]) return `newer_than:${newer[1]}d`;

  if (/\byesterday\b/i.test(q)) return "newer_than:2d";
  if (/\btoday\b/i.test(q)) return "newer_than:1d";
  if (/\blast\s+week\b/i.test(q)) return "newer_than:7d";
  if (/\blast\s+month\b/i.test(q)) return "newer_than:30d";
  if (/\blast\s+year\b/i.test(q)) return "newer_than:365d";

  const months: Record<string, string> = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12",
  };

  // Apr 23, 2026 / April 23 2026 / 4/23/2026
  const named = q.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i,
  );
  if (named) {
    const mon = months[named[1]!.toLowerCase()];
    const day = named[2]!.padStart(2, "0");
    const year = named[3] ?? String(new Date().getFullYear());
    if (mon) {
      const d = new Date(`${year}-${mon}-${day}T12:00:00Z`);
      if (!Number.isNaN(d.getTime())) {
        const before = new Date(d);
        before.setUTCDate(before.getUTCDate() + 1);
        const after = new Date(d);
        after.setUTCDate(after.getUTCDate() - 1);
        const fmt = (x: Date) =>
          `${x.getUTCFullYear()}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/${String(x.getUTCDate()).padStart(2, "0")}`;
        return `after:${fmt(after)} before:${fmt(before)}`;
      }
    }
  }

  const numeric = q.match(/\b(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
  if (numeric) {
    const year = numeric[1]!;
    const mon = numeric[2]!.padStart(2, "0");
    const day = numeric[3]!.padStart(2, "0");
    return `after:${year}/${mon}/${String(Math.max(1, Number(day) - 1)).padStart(2, "0")} before:${year}/${mon}/${String(Math.min(31, Number(day) + 1)).padStart(2, "0")}`;
  }

  return null;
}

function combineQueryParts(parts: string[]): string {
  const uniq = [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
  if (uniq.length === 0) return "";
  if (uniq.length === 1) return uniq[0]!;
  return `(${uniq.join(" ")})`;
}

const DATE_MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

export type ParsedDateRange =
  | { kind: "relativeDays"; days: number }
  | { kind: "day"; year: number; month: number; day: number };

/**
 * Shared spoken-date parser used by both Gmail and Drive query builders.
 * Returns either a relative window (days back) or a single calendar day.
 */
export function parseDateRange(text: string): ParsedDateRange | null {
  const q = text.trim();
  const rel = q.match(/\b(?:last|past)\s+(\d+)\s+days?\b/i);
  if (rel?.[1]) return { kind: "relativeDays", days: Number(rel[1]) };
  if (/\byesterday\b/i.test(q)) return { kind: "relativeDays", days: 2 };
  if (/\btoday\b/i.test(q)) return { kind: "relativeDays", days: 1 };
  if (/\blast\s+week\b/i.test(q)) return { kind: "relativeDays", days: 7 };
  if (/\blast\s+month\b/i.test(q)) return { kind: "relativeDays", days: 30 };
  if (/\blast\s+year\b/i.test(q)) return { kind: "relativeDays", days: 365 };

  const named = q.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i,
  );
  if (named) {
    const mon = DATE_MONTHS[named[1]!.toLowerCase()];
    if (mon) {
      return {
        kind: "day",
        year: named[3] ? Number(named[3]) : new Date().getFullYear(),
        month: Number(mon),
        day: Number(named[2]),
      };
    }
  }

  const numeric = q.match(/\b(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
  if (numeric) {
    return {
      kind: "day",
      year: Number(numeric[1]),
      month: Number(numeric[2]),
      day: Number(numeric[3]),
    };
  }

  return null;
}

/**
 * Fast rule-based NL → Gmail query for common phrasings.
 */
export function planGmailSearchHeuristic(text: string): PlannedGmailSearch | null {
  const q = text.trim();
  if (!q || !isEmailSearchIntent(q)) return null;

  const person = extractMailPersonName(q);
  const datePart = extractGmailDateConstraint(q);
  const parts: string[] = [];

  const fromMatch =
    q.match(/\blook(?:ing)?\s+for\s+emails?\s+from\s+(.+?)(?:\?|[.!]|$)/i) ??
    q.match(/\b(?:emails?|e-mails?|mail|messages?|inbox)\s+from\s+(.+?)(?:\?|[.!]|looking|please|$)/i) ??
    q.match(
      /\bfrom\s+([A-Za-z][A-Za-z0-9.'\-]+(?:\s+[A-Za-z][A-Za-z0-9.'\-]+){0,3}?)(?=\s+(?:about|regarding|re|on|last|yesterday|today|in|at|around)|[?!.]|$)/i,
    ) ??
    q.match(
      /\b(?:sent|emailed)\s+(?:to me\s+)?by\s+([A-Za-z][A-Za-z0-9.'\-]+(?:\s+[A-Za-z][A-Za-z0-9.'\-]+){0,3}?)(?:\?|[.!]|$)/i,
    );

  if (fromMatch?.[1] || person) {
    const who = cleanMailPersonName(fromMatch?.[1] ?? person ?? "");
    if (who) {
      const personQ = buildGmailPersonQuery(who);
      if (personQ) parts.push(personQ);
    }
  }

  const about =
    q.match(/\b(?:emails?|mail|messages?)\s+(?:about|regarding|re|on)\s+(.+?)(?:\?|[.!]|$)/i) ??
    q.match(/\b(?:about|regarding|re)\s+(?:the\s+)?(.+?)(?:\s+(?:email|mail|message)|[?!.,]|$)/i) ??
    q.match(/\bsubject\s*[:=]?\s*["']?(.+?)["']?(?:\?|[.!]|$)/i);

  if (about?.[1]) {
    let topic = about[1].trim().replace(/[?.!]+$/g, "").trim();
    topic = topic.replace(/\b(from|by)\s+.+$/i, "").trim();
    if (topic.length >= 2 && topic.length < 80) {
      parts.push(`(${topic})`);
    }
  }

  if (datePart) parts.push(datePart);

  if (parts.length === 0) return null;

  return {
    query: combineQueryParts(parts),
    personName: person,
    source: "heuristic",
  };
}

/** Strip filler words and use remaining tokens as a Gmail free-text query. */
export function planGmailSearchKeywords(text: string): PlannedGmailSearch | null {
  const person = extractMailPersonName(text);
  const datePart = extractGmailDateConstraint(text);
  let raw = text
    .replace(EMAIL_INTENT, " ")
    .replace(SEARCHY, " ")
    .replace(FILLER, " ")
    .replace(/[?!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Drop relative-date words already converted.
  raw = raw
    .replace(
      /\b(yesterday|today|last\s+week|last\s+month|last\s+year|apr(?:il)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}(?:st|nd|rd|th)?|20\d{2})\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  const parts: string[] = [];
  if (person) {
    const pq = buildGmailPersonQuery(person);
    if (pq) parts.push(pq);
  } else if (raw.length >= 2) {
    parts.push(raw);
  }
  if (datePart) parts.push(datePart);
  if (parts.length === 0 && raw.length >= 2) parts.push(raw);
  if (parts.length === 0) return null;

  return {
    query: combineQueryParts(parts),
    personName: person,
    source: "keywords",
  };
}

async function planGmailSearchWithAi(text: string): Promise<PlannedGmailSearch | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  // Planning is a small, latency-sensitive step — use the faster planner model when set.
  const model =
    process.env.OPENAI_PLANNER_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4o-mini";
  const client = new OpenAI({ apiKey });
  const today = new Date().toISOString().slice(0, 10);

  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 200,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You convert natural-language requests into Gmail search queries.
Today's date is ${today} (America/New_York unless stated).
Return ONLY JSON: {"query":"string","personName":"string|null"}
Rules:
- query must be valid Gmail search syntax (from:, to:, subject:, after:YYYY/MM/DD, before:YYYY/MM/DD, newer_than:Nd, OR, quotes, parentheses).
- When a person's name is given, do NOT use only from:(Full Name). Prefer:
  (from:(Full Name) OR from:First OR from:Last OR "Full Name" OR (Full Name))
  because From display names are often business names (e.g. Nancy Bryant → Bryant Permit Service).
- Include date operators when the user mentions a date or relative time.
- Include subject/topic keywords when the user mentions what the email was about.
- Never invent email addresses you were not given.
- If the request is not about finding email, return {"query":"","personName":null}.`,
      },
      { role: "user", content: text },
    ],
  });

  const raw = completion.choices[0]?.message.content?.trim() || "";
  try {
    const parsed = JSON.parse(raw) as { query?: unknown; personName?: unknown };
    const query = typeof parsed.query === "string" ? parsed.query.trim() : "";
    if (!query) return null;
    const personName =
      typeof parsed.personName === "string" && parsed.personName.trim()
        ? parsed.personName.trim()
        : extractMailPersonName(text);
    return { query, personName, source: "ai" };
  } catch {
    return null;
  }
}

/**
 * Backfill a Gmail plan with a person already resolved elsewhere (e.g. Ask's
 * People/Life-Memory retrieval, which maps relationship words like "wife" to
 * an actual contact via their `role` field). Neither the heuristic nor the AI
 * planner above sees that resolved corpus, so relationship phrasing such as
 * "my wife's last email" would otherwise plan a literal "wife" keyword search
 * that can never match a real inbox — only fill in when the planner (or the
 * caller, when plan is null) found no person of its own.
 */
export function backfillGmailPlanWithNamedPerson(
  plan: PlannedGmailSearch | null,
  person: { displayName: string; email?: string | null } | null | undefined,
  ...dateSourceTexts: string[]
): PlannedGmailSearch | null {
  if (!person || plan?.personName) return plan;
  const personQuery = buildGmailPersonQuery(person.displayName, person.email ?? null);
  if (!personQuery) return plan;
  let datePart: string | null = null;
  for (const text of dateSourceTexts) {
    datePart = extractGmailDateConstraint(text);
    if (datePart) break;
  }
  return {
    query: datePart ? `(${personQuery} ${datePart})` : personQuery,
    personName: person.displayName,
    source: "heuristic",
  };
}

/**
 * Plan a live Gmail search from natural language.
 * Prefers AI when available; falls back to heuristics then keyword stripping.
 */
export async function planGmailSearch(text: string): Promise<PlannedGmailSearch | null> {
  const q = text.trim();
  if (!q || !isEmailSearchIntent(q)) return null;

  try {
    const ai = await planGmailSearchWithAi(q);
    if (ai?.query) return ai;
  } catch {
    // Fall through to heuristics.
  }

  return planGmailSearchHeuristic(q) ?? planGmailSearchKeywords(q);
}
