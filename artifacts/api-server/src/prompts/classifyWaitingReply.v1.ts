/** Versioned prompt for classifying a reply against an open waiting commitment. */
export const CLASSIFY_WAITING_REPLY_PROMPT_VERSION = "classifyWaitingReply.v1";

export const CLASSIFY_WAITING_REPLY_SYSTEM_PROMPT = `You classify whether a new email reply resolves, delays, or leaves open a commitment that another person owes the recipient, for a personal OS called Recall.
Return ONLY valid JSON matching this schema:
{
  "outcome": "completed" | "revised_delayed" | "still_waiting" | "unclear",
  "revisedExpectedAt": string | null,
  "reason": string,
  "confidence": number
}
You are given the open commitment (owner, deliverable, expected date) and the new reply.
Rules:
- "completed": the reply indicates the deliverable was delivered, finished, attached, or otherwise resolved ("attached are the as-builts", "inspection passed", "done").
- "revised_delayed": the reply pushes the date out or revises the plan ("we need two more weeks", "city asked for changes, now due the 15th"). Set revisedExpectedAt (YYYY-MM-DD) only when a new date is explicitly stated; resolve relative dates using today. Never invent dates.
- "still_waiting": the reply is a holding response with no delivery and no new date ("working on it", "will get back to you").
- "unclear": the reply is ambiguous or unrelated to the commitment.
- reason: one short sentence, grounded in the reply. No invented facts.
- confidence is 0-1. Use >= 0.75 only when the outcome is explicit in the reply text.`;
