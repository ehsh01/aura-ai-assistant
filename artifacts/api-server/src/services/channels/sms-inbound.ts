import { and, eq } from "drizzle-orm";
import { users } from "@workspace/db/schema";
import { getDb } from "../../lib/db";
import { normalizePhoneNumberE164 } from "../notification-settings";
import { confirmProposedAction } from "../action-orchestrator";
import { getProposalForUser, listLatestOpenProposalForUser } from "../action-proposals";
import { receiveVoiceCapture } from "../voice-first/pipeline";
import { completeWaitingItem, listWaitingItemsForUser, snoozeWaitingItem } from "../waiting-items";
import { listAttentionForToday, snoozeAttention } from "../attention";
import { getSmsSessionForUser, setSmsSessionForUser } from "../working-context";
import { writeAuditLog } from "../audit";
import { compactSmsAnswer, parseSmsCommand } from "./sms-commands";
import type { ChannelReply } from "./types";

const recentByPhone = new Map<string, number[]>();
const MAX_PER_HOUR = 20;

function rateLimitOk(phone: string): boolean {
  const now = Date.now();
  const windowStart = now - 60 * 60_000;
  const prev = (recentByPhone.get(phone) ?? []).filter((t) => t > windowStart);
  if (prev.length >= MAX_PER_HOUR) {
    recentByPhone.set(phone, prev);
    return false;
  }
  prev.push(now);
  recentByPhone.set(phone, prev);
  return true;
}

export async function findUserByInboundPhone(from: string): Promise<{
  id: string;
  name: string;
} | null> {
  const phone = normalizePhoneNumberE164(from);
  if (!phone) return null;
  const rows = await getDb()
    .select({ id: users.id, name: users.name, enabled: users.smsInboundEnabled })
    .from(users)
    .where(and(eq(users.phoneNumber, phone), eq(users.smsInboundEnabled, true)))
    .limit(1);
  const row = rows[0];
  if (!row?.enabled) return null;
  return { id: row.id, name: row.name };
}

async function confirmLastProposal(userId: string): Promise<string> {
  const session = await getSmsSessionForUser(userId);
  const proposalId =
    session.proposalId ?? (await listLatestOpenProposalForUser(userId))?.id ?? null;
  if (!proposalId) return "Nothing waiting to confirm. Open Today if you want to review items.";
  const proposal = await getProposalForUser(userId, proposalId);
  if (!proposal || proposal.status !== "proposed") {
    return "That item is no longer waiting for confirmation.";
  }
  const result = await confirmProposedAction(userId, {
    type: proposal.type,
    draft: proposal.draft,
    rawCaptureId: proposal.captureId,
    threadId: proposal.threadId,
    proposalId: proposal.id,
  });
  await setSmsSessionForUser(userId, { proposalId: null });
  return `Done. Saved ${result.entityType.replace(/_/g, " ")}.`;
}

async function cancelLastProposal(userId: string): Promise<string> {
  const session = await getSmsSessionForUser(userId);
  const proposalId =
    session.proposalId ?? (await listLatestOpenProposalForUser(userId))?.id ?? null;
  if (!proposalId) return "Nothing to cancel.";
  const { cancelProposalForUser: cancel } = await import("../action-proposals");
  await cancel(userId, proposalId);
  await setSmsSessionForUser(userId, { proposalId: null });
  return "Cancelled. Nothing was saved.";
}

async function markTopDone(userId: string): Promise<string> {
  const waiting = await listWaitingItemsForUser(userId, { status: "open", limit: 5 });
  const top = waiting[0];
  if (top) {
    await completeWaitingItem(userId, top.id);
    return `Marked done: ${top.deliverable}`;
  }
  return "Nothing open to mark done. Check Today for the rest.";
}

async function snoozeTop(userId: string, preset: "1d" | "3d" | "1w"): Promise<string> {
  const attentionPreset = preset === "1w" ? "7d" : preset;
  const waiting = await listWaitingItemsForUser(userId, { status: "open", limit: 5 });
  if (waiting[0]) {
    await snoozeWaitingItem(userId, waiting[0].id, { preset: attentionPreset });
    return `Snoozed “${waiting[0].deliverable}” for ${preset}.`;
  }
  const attention = await listAttentionForToday(userId, 5);
  const open = attention.find((a) => a.status === "open" || a.status === "seen");
  if (open) {
    await snoozeAttention(userId, open.id, { preset: preset === "1w" ? "7d" : "3d" });
    return `Snoozed “${open.title}”.`;
  }
  return "Nothing to snooze right now.";
}

async function handleFreeText(
  userId: string,
  text: string,
  idempotencyKey: string | null,
): Promise<ChannelReply> {
  const session = await getSmsSessionForUser(userId);
  const plan = await receiveVoiceCapture({
    userId,
    text,
    source: "sms",
    sessionId: session.threadId,
    idempotencyKey,
    metadata: { channel: "sms" },
  });

  if (plan.mode === "answer" && plan.answer?.answer) {
    return {
      text: compactSmsAnswer(plan.answer.answer),
      confirmationStyle: "none",
    };
  }

  const action = plan.actions[0];
  if (action) {
    await setSmsSessionForUser(userId, {
      proposalId: action.id,
      threadId: session.threadId,
    });
    const clarify = plan.links.clarification;
    const body = clarify
      ? compactSmsAnswer(clarify)
      : `I'll ${action.label.toLowerCase()}: ${action.draft.title}. Reply YES to confirm or NO to cancel.`;
    return { text: body, confirmationStyle: "reply_yes", proposalId: action.id };
  }

  return {
    text: "Saved. I'll organize it — open Today if you want to review.",
    confirmationStyle: "none",
  };
}

export async function handleInboundSms(input: {
  from: string;
  body: string;
  messageSid?: string | null;
}): Promise<{ status: number; reply: string }> {
  const from = input.from.trim();
  if (!rateLimitOk(from)) {
    return { status: 429, reply: "Too many texts. Try again in a bit." };
  }

  const user = await findUserByInboundPhone(from);
  if (!user) {
    return { status: 404, reply: "" };
  }

  const command = parseSmsCommand(input.body);
  let reply: ChannelReply = { text: "I didn't catch that.", confirmationStyle: "none" };

  try {
    switch (command.kind) {
      case "confirm":
        reply = { text: await confirmLastProposal(user.id), confirmationStyle: "none" };
        break;
      case "cancel":
        reply = { text: await cancelLastProposal(user.id), confirmationStyle: "none" };
        break;
      case "done":
        reply = { text: await markTopDone(user.id), confirmationStyle: "none" };
        break;
      case "snooze":
        reply = { text: await snoozeTop(user.id, command.preset), confirmationStyle: "none" };
        break;
      case "choice":
        reply = {
          text: "Open Today to pick which person or project — I won't guess from a number.",
          confirmationStyle: "none",
        };
        break;
      case "remember":
        reply = await handleFreeText(
          user.id,
          `Remember: ${command.text}`,
          input.messageSid ?? null,
        );
        break;
      case "free_text":
        if (!command.text) {
          reply = { text: "Send a reminder, a question, or YES to confirm the last draft.", confirmationStyle: "none" };
        } else {
          reply = await handleFreeText(user.id, command.text, input.messageSid ?? null);
        }
        break;
    }

    await writeAuditLog({
      userId: user.id,
      action: "sms_inbound_handled",
      entityType: "channel",
      metadata: { kind: command.kind, sid: input.messageSid ?? null },
    });
  } catch (err) {
    reply = {
      text: "I saved your text, but couldn't finish that action. Try Today in the app.",
      confirmationStyle: "none",
    };
    await writeAuditLog({
      userId: user.id,
      action: "sms_inbound_failed",
      entityType: "channel",
      metadata: { message: err instanceof Error ? err.message : "error" },
    });
  }

  return { status: 200, reply: reply.text };
}
