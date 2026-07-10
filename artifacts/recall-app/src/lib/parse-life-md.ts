import type { LifeMemoryDomain } from "@/lib/recall-api";
import { LIFE_MEMORY_DOMAINS } from "@/lib/recall-api";

export type MemoryImportDraft = {
  id: string;
  title: string;
  content: string;
  domain: LifeMemoryDomain;
  include: boolean;
  classifying?: boolean;
};

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/;

const DOMAIN_FROM_HEADING: { domain: LifeMemoryDomain; re: RegExp }[] = [
  { domain: "family", re: /\b(family|wife|husband|kids?|children|spouse)\b/i },
  { domain: "vehicles", re: /\b(vehicle|car|truck|vin|tesla|auto)\b/i },
  { domain: "home", re: /\b(home|house|apartment|property|address)\b/i },
  { domain: "health", re: /\b(health|medical|doctor|medication)\b/i },
  { domain: "work", re: /\b(work|job|career|office|employer)\b/i },
  { domain: "finance", re: /\b(finance|money|bank|budget|tax)\b/i },
  { domain: "people", re: /\b(people|contacts?|friends?)\b/i },
  { domain: "preferences", re: /\b(prefer|preference|favorite|likes?)\b/i },
  { domain: "procedures", re: /\b(procedure|how\s*to|checklist|process|sop)\b/i },
];

function guessDomainFromTitle(title: string): LifeMemoryDomain | null {
  const lower = title.toLowerCase().trim();
  if ((LIFE_MEMORY_DOMAINS as readonly string[]).includes(lower)) {
    return lower as LifeMemoryDomain;
  }
  for (const { domain, re } of DOMAIN_FROM_HEADING) {
    if (re.test(title)) return domain;
  }
  return null;
}

function cleanTitle(raw: string): string {
  return raw.replace(/^#+\s*/, "").trim().slice(0, 200) || "Untitled";
}

/**
 * Split a personal markdown file into reviewable memory chunks.
 * Prefers # / ## / ### headings; falls back to thematic breaks (---) or size-capped paragraphs.
 */
export function splitMarkdownIntoMemoryChunks(markdown: string): Omit<
  MemoryImportDraft,
  "include" | "classifying"
>[] {
  const text = markdown.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const lines = text.split("\n");
  const hasHeadings = lines.some((l) => HEADING_RE.test(l));

  const raw: { title: string; body: string }[] = [];

  if (hasHeadings) {
    let title = "Untitled";
    let body: string[] = [];
    let sawHeading = false;

    const flush = () => {
      const content = body.join("\n").trim();
      if (!content && !sawHeading) return;
      if (!content) return;
      raw.push({ title: cleanTitle(title), body: content });
    };

    for (const line of lines) {
      const m = line.match(HEADING_RE);
      if (m) {
        if (sawHeading || body.some((b) => b.trim())) flush();
        title = m[2] ?? "Untitled";
        body = [];
        sawHeading = true;
        continue;
      }
      body.push(line);
    }
    flush();
  } else if (/\n---+\n/.test(`\n${text}\n`)) {
    const parts = text.split(/\n-{3,}\n/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const firstLine = trimmed.split("\n").find(Boolean) ?? "Untitled";
      const title = cleanTitle(firstLine.replace(/^[*_]+|[*_]+$/g, ""));
      raw.push({ title, body: trimmed });
    }
  } else {
    // Pack paragraphs into ~1200-char chunks.
    const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let buf: string[] = [];
    let size = 0;
    const flush = () => {
      if (buf.length === 0) return;
      const content = buf.join("\n\n");
      const title = cleanTitle(content.split(/\n/).find(Boolean) ?? "Memory");
      raw.push({ title: title.slice(0, 80), body: content });
      buf = [];
      size = 0;
    };
    for (const p of paras) {
      if (size + p.length > 1200 && buf.length > 0) flush();
      buf.push(p);
      size += p.length;
    }
    flush();
  }

  return raw.map((r, i) => {
    const domainGuess = guessDomainFromTitle(r.title) ?? "other";
    return {
      id: `draft-${i}-${Date.now()}`,
      title: r.title,
      content: r.body,
      domain: domainGuess,
    };
  });
}
