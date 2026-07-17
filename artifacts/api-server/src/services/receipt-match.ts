import { and, desc, eq, sql } from "drizzle-orm";
import { documents, sourceRecords } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { classifyFinanceTransaction } from "./finance-classify";
import { deleteEntityLink, listLinksFromEntity, upsertEntityLink } from "./entity-links";
import { formatMoney } from "./query-utils";

export const RECEIPT_LINK = "receipt_for";

export type ReceiptCandidate = {
  sourceRecordId: string;
  date: string;
  payee: string;
  amount: number;
  amountFormatted: string;
  score: number;
  reasons: string[];
};

/** Extract likely amounts like $12.34 or 12.34 from receipt text. */
export function extractReceiptAmounts(text: string): number[] {
  const amounts: number[] = [];
  const re = /\$?\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    const n = Number(m[1]!.replace(/,/g, ""));
    if (Number.isFinite(n) && n >= 1 && n < 100_000) amounts.push(n);
  }
  return [...new Set(amounts)].slice(0, 12);
}

/** Extract ISO-ish dates YYYY-MM-DD or MM/DD/YYYY. */
export function extractReceiptDates(text: string): string[] {
  const dates: string[] = [];
  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    dates.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g)) {
    const mm = m[1]!.padStart(2, "0");
    const dd = m[2]!.padStart(2, "0");
    dates.push(`${m[3]}-${mm}-${dd}`);
  }
  return [...new Set(dates)].slice(0, 8);
}

export function scoreReceiptMatch(input: {
  receiptAmounts: number[];
  receiptDates: string[];
  receiptText: string;
  amount: number;
  date: string;
  payee: string;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const absAmt = Math.abs(input.amount);
  for (const a of input.receiptAmounts) {
    if (Math.abs(a - absAmt) < 0.02) {
      score += 5;
      reasons.push("exact amount");
      break;
    }
    if (Math.abs(a - absAmt) <= 1) {
      score += 2;
      reasons.push("near amount");
      break;
    }
  }
  if (input.receiptDates.includes(input.date)) {
    score += 3;
    reasons.push("same date");
  } else if (input.receiptDates.some((d) => Math.abs(Date.parse(d) - Date.parse(input.date)) <= 86_400_000 * 2)) {
    score += 1;
    reasons.push("nearby date");
  }
  const payeeTok = input.payee.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const hay = input.receiptText.toLowerCase();
  const hit = payeeTok.find((t) => hay.includes(t));
  if (hit) {
    score += 2;
    reasons.push(`payee “${hit}”`);
  }
  return { score, reasons };
}

export async function suggestReceiptMatchesForDocument(
  userId: string,
  documentId: string,
  limit = 8,
): Promise<{ documentId: string; candidates: ReceiptCandidate[] } | null> {
  const docs = await getDb()
    .select({
      id: documents.id,
      extractedText: documents.extractedText,
      summary: documents.summary,
      fileName: documents.fileName,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  const doc = docs[0];
  if (!doc) return null;

  const text = [doc.fileName, doc.summary, doc.extractedText].filter(Boolean).join("\n");
  const receiptAmounts = extractReceiptAmounts(text);
  const receiptDates = extractReceiptDates(text);

  const rows = await getDb()
    .select({
      id: sourceRecords.id,
      recordMetadata: sourceRecords.recordMetadata,
      sourceCreatedAt: sourceRecords.sourceCreatedAt,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.recordType, "finance_transaction"),
      ),
    )
    .orderBy(desc(sql`coalesce(${sourceRecords.sourceCreatedAt}, ${sourceRecords.updatedAt})`))
    .limit(400);

  const linked = await listLinksFromEntity(userId, "document", documentId, {
    linkType: RECEIPT_LINK,
    toEntityType: "source_record",
  });
  const linkedIds = new Set(linked.map((l) => l.toEntityId));

  const candidates: ReceiptCandidate[] = [];
  for (const row of rows) {
    if (linkedIds.has(row.id)) continue;
    const meta = row.recordMetadata ?? {};
    const amount = typeof meta.amount === "number" ? meta.amount : Number(meta.amount);
    if (!Number.isFinite(amount)) continue;
    const kind = classifyFinanceTransaction({
      amount,
      payee: typeof meta.payee === "string" ? meta.payee : null,
      category: typeof meta.category === "string" ? meta.category : null,
      type: typeof meta.type === "string" ? meta.type : null,
      transferSubtype:
        typeof meta.transferSubtype === "string" ? meta.transferSubtype : null,
      affectsSpending:
        typeof meta.affectsSpending === "boolean" || typeof meta.affectsSpending === "string"
          ? meta.affectsSpending
          : null,
    });
    if (kind !== "expense") continue;
    const date =
      (typeof meta.date === "string" && meta.date) ||
      (row.sourceCreatedAt ? row.sourceCreatedAt.toISOString().slice(0, 10) : "");
    const payee = (typeof meta.payee === "string" && meta.payee) || "Unknown";
    const { score, reasons } = scoreReceiptMatch({
      receiptAmounts,
      receiptDates,
      receiptText: text,
      amount,
      date,
      payee,
    });
    if (score < 3) continue;
    candidates.push({
      sourceRecordId: row.id,
      date,
      payee,
      amount,
      amountFormatted: formatMoney(amount),
      score,
      reasons,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return { documentId, candidates: candidates.slice(0, limit) };
}

export async function confirmReceiptMatch(
  userId: string,
  documentId: string,
  sourceRecordId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const docs = await getDb()
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  if (!docs[0]) return { ok: false, error: "Document not found" };
  const txs = await getDb()
    .select({ id: sourceRecords.id })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.id, sourceRecordId),
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.recordType, "finance_transaction"),
      ),
    )
    .limit(1);
  if (!txs[0]) return { ok: false, error: "Transaction not found" };

  await upsertEntityLink(userId, {
    fromEntityType: "document",
    fromEntityId: documentId,
    toEntityType: "source_record",
    toEntityId: sourceRecordId,
    linkType: RECEIPT_LINK,
  });
  return { ok: true };
}

export async function unlinkReceiptMatch(
  userId: string,
  documentId: string,
  sourceRecordId: string,
): Promise<boolean> {
  return deleteEntityLink(userId, {
    fromEntityType: "document",
    fromEntityId: documentId,
    toEntityType: "source_record",
    toEntityId: sourceRecordId,
    linkType: RECEIPT_LINK,
  });
}
