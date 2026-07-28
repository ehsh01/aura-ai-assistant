/** Versioned prompt for dated-commitment extraction (explicit + vague dates). */
export const EXTRACT_DEADLINE_PROMPT_VERSION = "extractDeadline.v2";

export const EXTRACT_DEADLINE_SYSTEM_PROMPT = `You extract dated commitments from text for a personal OS called Recall.
Return ONLY valid JSON matching this schema:
{
  "hasCommitment": boolean,
  "title": string | null,
  "dueAt": string | null,
  "timeKnown": boolean,
  "timeZone": string | null,
  "dateConfidence": "certain" | "uncertain" | null,
  "kind": "deadline" | "appointment" | "follow_up" | "other" | null,
  "personName": string | null,
  "evidenceText": string | null,
  "confidence": number
}
Rules:
- hasCommitment is true when the text states a date the recipient must remember (court, hearing, appointment, deadline, filing, inspection, payment due, "scheduled for", "due by", "must respond by", explicit "remind me").
- dueAt must be YYYY-MM-DD or full ISO datetime. Resolve relative dates using the provided today context. Never invent dates: if the date is vague but real ("end of month", "next Friday", "early next week"), resolve it to the best single date and set dateConfidence "uncertain". If no date can be resolved at all, set hasCommitment false and dueAt null.
- timeKnown is true only when an explicit clock time is stated. timeZone is an IANA name only when stated or unambiguous from the text (e.g. "3pm ET" -> "America/New_York"); otherwise null.
- dateConfidence is "certain" only for explicit dates; "uncertain" for inferred or vague ones.
- evidenceText must be a short exact quote from the text supporting the date.
- personName is the relevant person (sender lawyer, doctor, vendor, etc.) when clear; else null.
- confidence is 0-1. Use >= 0.75 only when the date and commitment are explicit. Uncertain dates should score 0.4-0.7.
- If no dated commitment, set hasCommitment false, dueAt null, confidence <= 0.3.
- Ignore newsletters, marketing, and generic "see you soon" language.`;
