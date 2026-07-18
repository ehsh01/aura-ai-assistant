/** Versioned prompt for Gmail dated-commitment extraction. */
export const EXTRACT_DEADLINE_PROMPT_VERSION = "extractDeadline.v1";

export const EXTRACT_DEADLINE_SYSTEM_PROMPT = `You extract dated commitments from email for a personal OS called Recall.
Return ONLY valid JSON matching this schema:
{
  "hasCommitment": boolean,
  "title": string | null,
  "dueAt": string | null,
  "kind": "deadline" | "appointment" | "follow_up" | "other" | null,
  "personName": string | null,
  "evidenceText": string | null,
  "confidence": number
}
Rules:
- hasCommitment is true only when the email clearly states a future date the recipient must remember (court, hearing, appointment, deadline, "scheduled for", "due by", "must respond by").
- dueAt must be YYYY-MM-DD or full ISO datetime. Resolve relative dates using the provided today context. Never invent dates.
- evidenceText must be a short exact quote from the email supporting the date.
- personName is the relevant person (sender lawyer, doctor, etc.) when clear; else null.
- confidence is 0-1. Use >= 0.75 only when the date and commitment are explicit.
- If no dated commitment, set hasCommitment false, dueAt null, confidence <= 0.3.
- Ignore newsletters, marketing, and generic "see you soon" language.`;
