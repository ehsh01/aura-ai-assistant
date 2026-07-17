import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { homes, sourceRecords, vehicles } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import type { QueryFinanceAggregate } from "./ai";
import {
  deleteEntityLink,
  listLinksFromEntity,
  upsertEntityLink,
} from "./entity-links";
import { classifyFinanceTransaction } from "./finance-classify";
import { aggregateFinance, formatMoney } from "./query-utils";

export const SUBJECT_EXPENSE_LINK = "expense_for";

export type SubjectType = "vehicle" | "home";

export type SubjectSpendTxn = {
  id: string;
  date: string;
  payee: string;
  amount: number;
  amountFormatted: string;
  category: string | null;
  kind: string;
};

export type SubjectSpendResult = {
  subjectType: SubjectType;
  subjectId: string;
  finance: QueryFinanceAggregate;
  transactions: SubjectSpendTxn[];
};

export type SubjectSpendSuggestion = SubjectSpendTxn & {
  score: number;
  matchedOn: string;
};

function tokensFromText(...parts: (string | null | undefined)[]): string[] {
  const raw = parts.filter(Boolean).join(" ").toLowerCase();
  const tokens = raw
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  return [...new Set(tokens)].slice(0, 12);
}

async function loadSubject(
  userId: string,
  subjectType: SubjectType,
  subjectId: string,
): Promise<{ displayName: string; tokens: string[] } | null> {
  if (subjectType === "vehicle") {
    const rows = await getDb()
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, subjectId), eq(vehicles.userId, userId)))
      .limit(1);
    const v = rows[0];
    if (!v) return null;
    return {
      displayName: v.displayName,
      tokens: tokensFromText(v.displayName, v.make, v.model, v.vin, v.licensePlate, v.notes),
    };
  }
  const rows = await getDb()
    .select()
    .from(homes)
    .where(and(eq(homes.id, subjectId), eq(homes.userId, userId)))
    .limit(1);
  const h = rows[0];
  if (!h) return null;
  return {
    displayName: h.displayName,
    tokens: tokensFromText(
      h.displayName,
      h.addressLine1,
      h.city,
      h.region,
      h.postalCode,
      h.notes,
    ),
  };
}

function metaToTxn(row: {
  id: string;
  recordMetadata: Record<string, unknown> | null;
  sourceCreatedAt: Date | null;
  recordText: string | null;
}): SubjectSpendTxn | null {
  const meta = row.recordMetadata ?? {};
  const amount = typeof meta.amount === "number" ? meta.amount : Number(meta.amount);
  if (!Number.isFinite(amount)) return null;
  const date =
    (typeof meta.date === "string" && meta.date) ||
    (row.sourceCreatedAt ? row.sourceCreatedAt.toISOString().slice(0, 10) : "");
  const payee =
    (typeof meta.payee === "string" && meta.payee.trim()) ||
    "Unknown";
  const kind = classifyFinanceTransaction({
    amount,
    payee,
    category: typeof meta.category === "string" ? meta.category : null,
    type: typeof meta.type === "string" ? meta.type : null,
    transferSubtype:
      typeof meta.transferSubtype === "string" ? meta.transferSubtype : null,
    affectsSpending:
      typeof meta.affectsSpending === "boolean" || typeof meta.affectsSpending === "string"
        ? meta.affectsSpending
        : null,
    affectsIncome:
      typeof meta.affectsIncome === "boolean" || typeof meta.affectsIncome === "string"
        ? meta.affectsIncome
        : null,
  });
  return {
    id: row.id,
    date,
    payee,
    amount,
    amountFormatted: formatMoney(amount),
    category: typeof meta.category === "string" ? meta.category : null,
    kind,
  };
}

export async function getSubjectSpendForUser(
  userId: string,
  subjectType: SubjectType,
  subjectId: string,
): Promise<SubjectSpendResult | null> {
  const subject = await loadSubject(userId, subjectType, subjectId);
  if (!subject) return null;

  const links = await listLinksFromEntity(userId, subjectType, subjectId, {
    linkType: SUBJECT_EXPENSE_LINK,
    toEntityType: "source_record",
  });
  const ids = links.map((l) => l.toEntityId);
  if (ids.length === 0) {
    const empty = aggregateFinance([], subject.displayName);
    return {
      subjectType,
      subjectId,
      finance: empty,
      transactions: [],
    };
  }

  const rows = await getDb()
    .select({
      id: sourceRecords.id,
      recordMetadata: sourceRecords.recordMetadata,
      sourceCreatedAt: sourceRecords.sourceCreatedAt,
      recordText: sourceRecords.recordText,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.recordType, "finance_transaction"),
        inArray(sourceRecords.id, ids),
      ),
    );

  const txns = rows
    .map((r) => {
      const meta = r.recordMetadata ?? {};
      const amount = typeof meta.amount === "number" ? meta.amount : Number(meta.amount);
      if (!Number.isFinite(amount)) return null;
      return {
        id: r.id,
        date:
          (typeof meta.date === "string" && meta.date) ||
          (r.sourceCreatedAt ? r.sourceCreatedAt.toISOString().slice(0, 10) : ""),
        amount,
        payee: typeof meta.payee === "string" ? meta.payee : null,
        category: typeof meta.category === "string" ? meta.category : null,
        type: typeof meta.type === "string" ? meta.type : null,
        transferSubtype:
          typeof meta.transferSubtype === "string" ? meta.transferSubtype : null,
        affectsSpending:
          typeof meta.affectsSpending === "boolean" ||
          typeof meta.affectsSpending === "string"
            ? meta.affectsSpending
            : null,
        affectsIncome:
          typeof meta.affectsIncome === "boolean" || typeof meta.affectsIncome === "string"
            ? meta.affectsIncome
            : null,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t != null);

  const finance = aggregateFinance(txns, subject.displayName);
  const transactions = txns
    .map((t) => ({
      id: t.id!,
      date: t.date,
      payee: (t.payee ?? "Unknown").trim() || "Unknown",
      amount: t.amount,
      amountFormatted: formatMoney(t.amount),
      category: t.category,
      kind: classifyFinanceTransaction(t),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { subjectType, subjectId, finance, transactions };
}

export async function suggestSubjectSpendForUser(
  userId: string,
  subjectType: SubjectType,
  subjectId: string,
  limit = 15,
): Promise<{ suggestions: SubjectSpendSuggestion[] } | null> {
  const subject = await loadSubject(userId, subjectType, subjectId);
  if (!subject) return null;
  if (subject.tokens.length === 0) return { suggestions: [] };

  const linked = await listLinksFromEntity(userId, subjectType, subjectId, {
    linkType: SUBJECT_EXPENSE_LINK,
    toEntityType: "source_record",
  });
  const linkedIds = new Set(linked.map((l) => l.toEntityId));

  const tokenFilters = subject.tokens.map(
    (tok) =>
      sql`(
        coalesce(${sourceRecords.recordTitle},'') ilike ${"%" + tok + "%"}
        or coalesce(${sourceRecords.recordText},'') ilike ${"%" + tok + "%"}
        or coalesce(${sourceRecords.recordMetadata}->>'payee','') ilike ${"%" + tok + "%"}
        or coalesce(${sourceRecords.recordMetadata}->>'category','') ilike ${"%" + tok + "%"}
      )`,
  );

  const rows = await getDb()
    .select({
      id: sourceRecords.id,
      recordMetadata: sourceRecords.recordMetadata,
      sourceCreatedAt: sourceRecords.sourceCreatedAt,
      recordText: sourceRecords.recordText,
      recordTitle: sourceRecords.recordTitle,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.recordType, "finance_transaction"),
        or(...tokenFilters),
      ),
    )
    .orderBy(desc(sql`coalesce(${sourceRecords.sourceCreatedAt}, ${sourceRecords.updatedAt})`))
    .limit(80);

  const suggestions: SubjectSpendSuggestion[] = [];
  for (const row of rows) {
    if (linkedIds.has(row.id)) continue;
    const txn = metaToTxn(row);
    if (!txn || txn.kind !== "expense") continue;
    const haystack = `${row.recordTitle ?? ""} ${row.recordText ?? ""} ${txn.payee} ${txn.category ?? ""}`.toLowerCase();
    const matched = subject.tokens.filter((t) => haystack.includes(t));
    if (matched.length === 0) continue;
    suggestions.push({
      ...txn,
      score: matched.length,
      matchedOn: matched.slice(0, 3).join(", "),
    });
  }

  suggestions.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  return { suggestions: suggestions.slice(0, limit) };
}

export async function linkSubjectExpense(
  userId: string,
  subjectType: SubjectType,
  subjectId: string,
  sourceRecordId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await loadSubject(userId, subjectType, subjectId))) {
    return { ok: false, error: "Subject not found" };
  }
  const rows = await getDb()
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
  if (!rows[0]) return { ok: false, error: "Transaction not found" };

  await upsertEntityLink(userId, {
    fromEntityType: subjectType,
    fromEntityId: subjectId,
    toEntityType: "source_record",
    toEntityId: sourceRecordId,
    linkType: SUBJECT_EXPENSE_LINK,
  });
  return { ok: true };
}

export async function unlinkSubjectExpense(
  userId: string,
  subjectType: SubjectType,
  subjectId: string,
  sourceRecordId: string,
): Promise<boolean> {
  if (!(await loadSubject(userId, subjectType, subjectId))) return false;
  return deleteEntityLink(userId, {
    fromEntityType: subjectType,
    fromEntityId: subjectId,
    toEntityType: "source_record",
    toEntityId: sourceRecordId,
    linkType: SUBJECT_EXPENSE_LINK,
  });
}
