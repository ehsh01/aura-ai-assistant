/**
 * Build compact Ask prompt text from a retrieved record.
 * Prefer digests unless expansion is warranted (FTS/top hits/pinned/email).
 */

export function wantsExactOrIdQuestion(question: string): boolean {
  return /\b(exact|vin|code|permit|invoice|amount|\$|id\b|serial|license|plate)\b/i.test(
    question,
  );
}

export function promptTextForRetrievedRecord(
  r: {
    entityType: string;
    title: string;
    text: string;
    digest?: string | null;
    pinned?: boolean;
    expandPreferred?: boolean;
    method?: string;
    score?: number;
  },
  opts: {
    question: string;
    rankIndex: number;
    emailIntent: boolean;
    forceExpand?: boolean;
  },
): string {
  const digest = r.digest?.trim();
  const expand =
    opts.forceExpand ||
    r.expandPreferred ||
    r.pinned ||
    opts.rankIndex < 3 ||
    (opts.emailIntent && r.entityType === "source_record") ||
    wantsExactOrIdQuestion(opts.question) ||
    !digest;

  if (!expand && digest) {
    return `${r.title}\n${digest}`;
  }
  return r.text;
}
