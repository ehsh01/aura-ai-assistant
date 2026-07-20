/**
 * Lightweight verifier for grounded LLM drafts.
 * Rejects answers that invent dollar amounts or uncitable claims.
 */

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Extract $ amounts from text for comparison against finance evidence. */
export function extractDollarAmounts(text: string): number[] {
  const amounts: number[] = [];
  const re = /\$\s*([\d,]+(?:\.\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = Number(m[1]!.replace(/,/g, ""));
    if (Number.isFinite(n)) amounts.push(n);
  }
  return amounts;
}

/**
 * If the draft mentions dollar amounts, each must appear (within 1 cent) in
 * the allowed finance formatted strings / evidence text.
 */
export function verifyFinanceAmountsInAnswer(
  answer: string,
  allowedFormatted: string[],
): VerifyResult {
  const amounts = extractDollarAmounts(answer);
  if (amounts.length === 0) return { ok: true };

  const allowed = new Set<number>();
  for (const s of allowedFormatted) {
    for (const n of extractDollarAmounts(s)) allowed.add(Math.round(n * 100));
  }
  // Also allow bare numbers from evidence without $ if present in formatted list.
  for (const s of allowedFormatted) {
    const bare = s.match(/-?[\d,]+\.\d{2}/g) ?? [];
    for (const b of bare) {
      const n = Number(b.replace(/,/g, ""));
      if (Number.isFinite(n)) allowed.add(Math.round(Math.abs(n) * 100));
    }
  }

  for (const amt of amounts) {
    const cents = Math.round(amt * 100);
    if (!allowed.has(cents)) {
      return {
        ok: false,
        reason: `Answer invents amount $${amt.toFixed(2)} not present in finance evidence.`,
      };
    }
  }
  return { ok: true };
}
