import { and, asc, desc, eq } from "drizzle-orm";
import { askMessages, askThreads, type AskMessage, type AskThread } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newAskMessageId, newAskThreadId } from "../lib/recall-format";

export type AskThreadDto = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AskMessageDto = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

const MAX_HISTORY_TURNS = 12;

function toThreadDto(row: AskThread): AskThreadDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMessageDto(row: AskMessage): AskMessageDto {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}

function titleFromQuestion(question: string): string {
  const cleaned = question.trim().replace(/\s+/g, " ");
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned || "New chat";
}

export async function listAskThreadsForUser(
  userId: string,
  limit = 30,
): Promise<AskThreadDto[]> {
  const rows = await getDb()
    .select()
    .from(askThreads)
    .where(eq(askThreads.userId, userId))
    .orderBy(desc(askThreads.updatedAt))
    .limit(limit);
  return rows.map(toThreadDto);
}

export async function getAskThreadForUser(
  userId: string,
  threadId: string,
): Promise<{ thread: AskThreadDto; messages: AskMessageDto[] } | null> {
  const threads = await getDb()
    .select()
    .from(askThreads)
    .where(and(eq(askThreads.id, threadId), eq(askThreads.userId, userId)))
    .limit(1);
  const thread = threads[0];
  if (!thread) return null;

  const messages = await getDb()
    .select()
    .from(askMessages)
    .where(and(eq(askMessages.threadId, threadId), eq(askMessages.userId, userId)))
    .orderBy(asc(askMessages.createdAt));

  return { thread: toThreadDto(thread), messages: messages.map(toMessageDto) };
}

export async function createAskThreadForUser(
  userId: string,
  title?: string,
): Promise<AskThreadDto> {
  const now = new Date();
  const [row] = await getDb()
    .insert(askThreads)
    .values({
      id: newAskThreadId(),
      userId,
      title: title?.trim() || "New chat",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toThreadDto(row!);
}

/** Thread row only — avoids loading the full message list when we just need metadata. */
export async function getAskThreadMetaForUser(
  userId: string,
  threadId: string,
): Promise<AskThreadDto | null> {
  const rows = await getDb()
    .select()
    .from(askThreads)
    .where(and(eq(askThreads.id, threadId), eq(askThreads.userId, userId)))
    .limit(1);
  return rows[0] ? toThreadDto(rows[0]) : null;
}

export async function ensureAskThreadForUser(
  userId: string,
  threadId: string | null | undefined,
  firstQuestion: string,
): Promise<AskThreadDto> {
  if (threadId) {
    // Only the thread row is needed here; recent turns are loaded separately.
    const existing = await getAskThreadMetaForUser(userId, threadId);
    if (existing) return existing;
  }
  return createAskThreadForUser(userId, titleFromQuestion(firstQuestion));
}

export async function listRecentTurnsForThread(
  userId: string,
  threadId: string,
  limit = MAX_HISTORY_TURNS,
): Promise<ConversationTurn[]> {
  const rows = await getDb()
    .select()
    .from(askMessages)
    .where(and(eq(askMessages.threadId, threadId), eq(askMessages.userId, userId)))
    .orderBy(desc(askMessages.createdAt))
    .limit(limit);
  return rows
    .reverse()
    .map((r) => ({
      role: (r.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: r.content,
    }));
}

export async function appendAskMessage(input: {
  userId: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<AskMessageDto> {
  const now = new Date();
  const [row] = await getDb()
    .insert(askMessages)
    .values({
      id: newAskMessageId(),
      threadId: input.threadId,
      userId: input.userId,
      role: input.role,
      content: input.content,
      metadata: input.metadata ?? {},
      createdAt: now,
    })
    .returning();

  await getDb()
    .update(askThreads)
    .set({ updatedAt: now })
    .where(and(eq(askThreads.id, input.threadId), eq(askThreads.userId, input.userId)));

  // Set title from first user message if still default.
  if (input.role === "user") {
    const threads = await getDb()
      .select()
      .from(askThreads)
      .where(and(eq(askThreads.id, input.threadId), eq(askThreads.userId, input.userId)))
      .limit(1);
    const thread = threads[0];
    if (thread && (thread.title === "New chat" || !thread.title.trim())) {
      await getDb()
        .update(askThreads)
        .set({ title: titleFromQuestion(input.content), updatedAt: now })
        .where(eq(askThreads.id, input.threadId));
    }
  }

  return toMessageDto(row!);
}

/** Build a retrieval query that includes prior user turns for follow-ups. */
export function retrievalQueryFromHistory(
  question: string,
  history: ConversationTurn[],
): string {
  const priorUser = history
    .filter((t) => t.role === "user")
    .slice(-3)
    .map((t) => t.content)
    .join("\n");
  if (!priorUser) return question;
  return `${priorUser}\n${question}`;
}
