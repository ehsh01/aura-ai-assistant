import OpenAI from "openai";
import { cleanMailPersonName } from "./connectors";
import { parseDateRange } from "./nl-gmail-query";

export type PlannedDriveSearch = {
  /** Full Drive `q` string (files.list query). */
  query: string;
  fileType: string | null;
  personName: string | null;
  source: "heuristic" | "ai" | "keywords";
};

const DRIVE_INTENT =
  /\b(drive|google\s*drive|document|documents|doc|docs|file|files|pdf|pdfs|spreadsheet|spreadsheets|sheet|sheets|slide|slides|presentation|presentations|folder|folders|attachment|attachments|contract|contracts|agreement|agreements|invoice|invoices|receipt|receipts|statement|statements|form|forms|scan|scanned|report|reports)\b/i;

const SEARCHY =
  /\b(find|search|look(?:ing)?\s+for|show(?:\s+me)?|any|get|pull|check|locate|fetch|open|read)\b/i;

const FILLER =
  /\b(please|okay|ok|hey|can you|could you|would you|i need|i want|help me|for me|in my|my|the|a|an|of|to|and|or|just|really|also|about|regarding|named|called|titled|that|which|with|containing|contains)\b/gi;

/** Words that name a Drive file type → Drive mimeType filter fragment. */
const FILE_TYPE_CLAUSES: { test: RegExp; type: string; clause: string }[] = [
  {
    test: /\bpdf(s)?\b/i,
    type: "pdf",
    clause: "mimeType = 'application/pdf'",
  },
  {
    test: /\b(spreadsheet|spreadsheets|excel|sheet|sheets|xlsx?|csv)\b/i,
    type: "spreadsheet",
    clause:
      "(mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType = 'application/vnd.ms-excel' or mimeType = 'text/csv')",
  },
  {
    test: /\b(slide|slides|presentation|presentations|powerpoint|pptx?)\b/i,
    type: "presentation",
    clause:
      "(mimeType = 'application/vnd.google-apps.presentation' or mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation' or mimeType = 'application/vnd.ms-powerpoint')",
  },
  {
    test: /\b(image|images|photo|photos|picture|pictures|scan|scanned|jpe?g|png)\b/i,
    type: "image",
    clause: "mimeType contains 'image/'",
  },
  {
    test: /\b(folder|folders)\b/i,
    type: "folder",
    clause: "mimeType = 'application/vnd.google-apps.folder'",
  },
  {
    test: /\b(word\s+doc(?:ument)?s?|docx|google\s+docs?)\b/i,
    type: "document",
    clause:
      "(mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType = 'application/msword')",
  },
];

/** Content words that describe a document kind — searched as text, not mimeType. */
const CONTENT_KIND_WORDS =
  /\b(contract|contracts|agreement|agreements|invoice|invoices|receipt|receipts|statement|statements|permit|permits|form|forms|report|reports|lease|leases|proposal|proposals|estimate|estimates|deed|deeds)\b/i;

export function isDriveSearchIntent(text: string): boolean {
  const q = text.trim();
  if (!q) return false;
  return DRIVE_INTENT.test(q);
}

/** Escape a value for use inside a single-quoted Drive query string. */
function escapeDriveValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function fileTypeClause(text: string): { type: string; clause: string } | null {
  for (const entry of FILE_TYPE_CLAUSES) {
    if (entry.test.test(text)) return { type: entry.type, clause: entry.clause };
  }
  return null;
}

/** Drive date clause from spoken dates ("last week", "Apr 23 2026"). */
export function extractDriveDateConstraint(text: string): string | null {
  const parsed = parseDateRange(text);
  if (!parsed) return null;
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  if (parsed.kind === "relativeDays") {
    const since = new Date(Date.now() - parsed.days * 24 * 60 * 60 * 1000);
    return `modifiedTime > '${iso(since)}'`;
  }
  const start = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0),
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return `(modifiedTime >= '${iso(start)}' and modifiedTime < '${iso(end)}')`;
}

/** Build a content clause matching a phrase in file body OR name. */
function contentClause(phrase: string): string | null {
  const value = phrase.trim();
  if (value.length < 2) return null;
  const esc = escapeDriveValue(value);
  return `(fullText contains '${esc}' or name contains '${esc}')`;
}

function assembleDriveQuery(
  clauses: (string | null)[],
): string {
  const parts = clauses.filter((c): c is string => Boolean(c && c.trim()));
  parts.push("trashed = false");
  return parts.join(" and ");
}

/** Extract the person referenced for a document ("contract from Nancy", "Nancy's invoice"). */
function extractDrivePerson(text: string): string | null {
  const q = text.trim();
  const m =
    q.match(/\bfrom\s+([A-Za-z][A-Za-z0-9.'\-]+(?:\s+[A-Za-z][A-Za-z0-9.'\-]+){0,2})\b/i) ??
    q.match(/\b(?:by|for)\s+([A-Za-z][A-Za-z0-9.'\-]+(?:\s+[A-Za-z][A-Za-z0-9.'\-]+){0,2})\b/i) ??
    q.match(/\b([A-Za-z][A-Za-z0-9.'\-]+(?:\s+[A-Za-z][A-Za-z0-9.'\-]+)?)'s\b/i);
  if (m?.[1] && !DRIVE_INTENT.test(m[1]) && !SEARCHY.test(m[1])) {
    return cleanMailPersonName(m[1]);
  }
  return null;
}

/** Rule-based NL → Drive query for common phrasings. */
export function planDriveSearchHeuristic(text: string): PlannedDriveSearch | null {
  const q = text.trim();
  if (!q || !isDriveSearchIntent(q)) return null;

  const type = fileTypeClause(q);
  const datePart = extractDriveDateConstraint(q);
  const person = extractDrivePerson(q);

  const contentClauses: string[] = [];

  // Explicit topic phrases: "about X", "named X", "called X", "contract for X".
  const about =
    q.match(/\b(?:about|regarding|re|on|named|called|titled|for)\s+(?:the\s+)?(.+?)(?:\?|[.!,]|$)/i) ??
    null;
  if (about?.[1]) {
    let topic = about[1].trim().replace(/[?.!,]+$/g, "").trim();
    topic = topic
      .replace(/\b(from|by)\s+[A-Za-z].*$/i, "")
      .replace(/\b(last\s+week|last\s+month|last\s+year|yesterday|today)\b/gi, "")
      .replace(DRIVE_INTENT, "")
      .replace(/\s+/g, " ")
      .trim();
    const c = topic.length >= 2 && topic.length < 80 ? contentClause(topic) : null;
    if (c) contentClauses.push(c);
  }

  // Document-kind words (contract, invoice, permit…) matched as content.
  const kind = q.match(CONTENT_KIND_WORDS);
  if (kind?.[0]) {
    const c = contentClause(kind[0]);
    if (c && !contentClauses.some((x) => x.includes(`'${kind[0]!.toLowerCase()}`))) {
      contentClauses.push(c);
    }
  }

  if (person) {
    const c = contentClause(person);
    if (c) contentClauses.push(c);
  }

  const query = assembleDriveQuery([
    contentClauses.length ? `(${contentClauses.join(" and ")})` : null,
    type?.clause ?? null,
    datePart,
  ]);

  // Require at least one real filter beyond trashed=false, else let keyword pass handle it.
  if (!contentClauses.length && !type && !datePart) return null;

  return {
    query,
    fileType: type?.type ?? null,
    personName: person,
    source: "heuristic",
  };
}

/** Keyword fallback: strip filler and match remaining tokens as file content/name. */
export function planDriveSearchKeywords(text: string): PlannedDriveSearch | null {
  const type = fileTypeClause(text);
  const datePart = extractDriveDateConstraint(text);
  // Only strip date-ish tokens (relative phrases, month names, ordinal days,
  // 4-digit years) — never bare numbers, which are often part of content
  // (e.g. an address like "779 NW 41 ST" or a permit number).
  let raw = text
    .replace(SEARCHY, " ")
    .replace(DRIVE_INTENT, " ")
    .replace(FILLER, " ")
    .replace(/[?!.,]/g, " ")
    .replace(
      /\b(last\s+week|last\s+month|last\s+year|yesterday|today|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}(?:st|nd|rd|th)|20\d{2})\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  const clauses: string[] = [];
  const content = raw.length >= 2 ? contentClause(raw) : null;
  if (content) clauses.push(content);

  if (!content && !type && !datePart) return null;

  return {
    query: assembleDriveQuery([content, type?.clause ?? null, datePart]),
    fileType: type?.type ?? null,
    personName: null,
    source: "keywords",
  };
}

async function planDriveSearchWithAi(text: string): Promise<PlannedDriveSearch | null> {
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
    max_tokens: 220,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You convert natural-language requests into Google Drive search queries (the "q" parameter of files.list).
Today's date is ${today} (America/New_York unless stated).
Return ONLY JSON: {"query":"string","fileType":"string|null","personName":"string|null"}
Rules:
- query MUST be valid Drive query syntax. Operators you may use: fullText contains 'x', name contains 'x', mimeType = '...', mimeType contains '...', modifiedTime > 'RFC3339', and, or, parentheses.
- To search inside documents (including PDFs and scanned/OCR'd files), use fullText contains 'keyword'. Combine several keywords with and/or.
- Always include: and trashed = false
- Map file types to mimeType when the user names one:
  - pdf -> mimeType = 'application/pdf'
  - spreadsheet/excel -> mimeType = 'application/vnd.google-apps.spreadsheet' or 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  - doc/word -> mimeType = 'application/vnd.google-apps.document' or 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  - slides/presentation -> mimeType = 'application/vnd.google-apps.presentation'
  - image/photo/scan -> mimeType contains 'image/'
  - folder -> mimeType = 'application/vnd.google-apps.folder'
- Escape single quotes inside values as \\'.
- Use modifiedTime for date filters (Drive has no newer_than).
- If the request is not about finding files/documents, return {"query":"","fileType":null,"personName":null}.`,
      },
      { role: "user", content: text },
    ],
  });

  const raw = completion.choices[0]?.message.content?.trim() || "";
  try {
    const parsed = JSON.parse(raw) as {
      query?: unknown;
      fileType?: unknown;
      personName?: unknown;
    };
    let query = typeof parsed.query === "string" ? parsed.query.trim() : "";
    if (!query) return null;
    if (!/trashed\s*=\s*false/i.test(query)) query = `${query} and trashed = false`;
    return {
      query,
      fileType: typeof parsed.fileType === "string" ? parsed.fileType : null,
      personName:
        typeof parsed.personName === "string" && parsed.personName.trim()
          ? parsed.personName.trim()
          : extractDrivePerson(text),
      source: "ai",
    };
  } catch {
    return null;
  }
}

/**
 * Plan a live Drive search from natural language.
 * Prefers AI when available; falls back to heuristics then keyword stripping.
 */
export async function planDriveSearch(text: string): Promise<PlannedDriveSearch | null> {
  const q = text.trim();
  if (!q || !isDriveSearchIntent(q)) return null;

  try {
    const ai = await planDriveSearchWithAi(q);
    if (ai?.query) return ai;
  } catch {
    // Fall through to heuristics.
  }

  return planDriveSearchHeuristic(q) ?? planDriveSearchKeywords(q);
}
