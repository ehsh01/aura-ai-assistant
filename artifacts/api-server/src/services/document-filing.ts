/**
 * Local filing hints for photos / pasted text. No model call.
 * Does not create invoices or warranties — only suggests a destination.
 */

export type FilingKind = "invoice" | "warranty" | "permit" | "insurance" | "document";

export type FilingSuggestion = {
  kind: FilingKind;
  label: string;
  href: string;
  reason: string;
};

const PATTERNS: { kind: FilingKind; re: RegExp; label: string; href: string; reason: string }[] = [
  {
    kind: "invoice",
    re: /\b(invoice|receipt|bill|amount due|balance due|acct[\s.]*#)\b/i,
    label: "File as invoice",
    href: "/organizations",
    reason: "Looks like a bill or receipt",
  },
  {
    kind: "warranty",
    re: /\b(warranty|guarantee|covered until|expires\s+\d)\b/i,
    label: "File as warranty",
    href: "/vehicles",
    reason: "Looks like a warranty or guarantee",
  },
  {
    kind: "permit",
    re: /\b(permit|as-?built|inspection\s+card|certificate of occupancy)\b/i,
    label: "File with home documents",
    href: "/documents",
    reason: "Looks like a permit or inspection document",
  },
  {
    kind: "insurance",
    re: /\b(insurance\s+card|policy\s+number|member\s+id|group\s+number)\b/i,
    label: "File as insurance document",
    href: "/documents",
    reason: "Looks like an insurance card",
  },
];

export function suggestDocumentFiling(text: string): FilingSuggestion | null {
  const blob = text.replace(/\s+/g, " ").trim();
  if (blob.length < 8) return null;
  for (const row of PATTERNS) {
    if (row.re.test(blob)) {
      return { kind: row.kind, label: row.label, href: row.href, reason: row.reason };
    }
  }
  return null;
}
