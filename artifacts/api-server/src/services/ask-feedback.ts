import { and, desc, eq } from "drizzle-orm";
import { askMessages, userCorrections } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { recordUserCorrection } from "./user-corrections";

export type AskFeedbackRating = "up" | "down";

export async function recordAskFeedbackForUser(
  userId: string,
  input: {
    messageId: string;
    rating: AskFeedbackRating;
    note?: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await getDb()
    .select({
      id: askMessages.id,
      role: askMessages.role,
      content: askMessages.content,
    })
    .from(askMessages)
    .where(and(eq(askMessages.id, input.messageId), eq(askMessages.userId, userId)))
    .limit(1);
  const msg = rows[0];
  if (!msg || msg.role !== "assistant") {
    return { ok: false, error: "Assistant message not found" };
  }

  await recordUserCorrection(userId, {
    entityType: "ask_message",
    entityId: msg.id,
    fieldName: "feedback",
    oldValue: msg.content.slice(0, 500),
    newValue: input.rating,
    reason: input.note?.trim().slice(0, 1000) || null,
  });
  return { ok: true };
}

/** Recent negative feedback notes for light prompt hints. */
export async function listRecentAskFeedbackHints(userId: string): Promise<string | null> {
  const rows = await getDb()
    .select({
      newValue: userCorrections.newValue,
      reason: userCorrections.reason,
    })
    .from(userCorrections)
    .where(
      and(
        eq(userCorrections.userId, userId),
        eq(userCorrections.entityType, "ask_message"),
        eq(userCorrections.fieldName, "feedback"),
      ),
    )
    .orderBy(desc(userCorrections.createdAt))
    .limit(8);

  const notes = rows
    .filter((r) => r.newValue === "down" && r.reason?.trim())
    .map((r) => r.reason!.trim())
    .slice(0, 3);
  if (notes.length === 0) return null;
  return `Recent user corrections on Ask answers (avoid repeating these mistakes):\n${notes
    .map((n, i) => `${i + 1}. ${n}`)
    .join("\n")}`;
}
