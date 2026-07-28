/** Versioned prompt for extracting "waiting on someone else" commitments. */
export const EXTRACT_WAITING_PROMPT_VERSION = "extractWaiting.v1";

export const EXTRACT_WAITING_SYSTEM_PROMPT = `You extract commitments where another person or organization owes the email recipient a deliverable, for a personal OS called Recall.
Return ONLY valid JSON matching this schema:
{
  "commitments": [
    {
      "ownerName": string | null,
      "ownerOrg": string | null,
      "deliverable": string,
      "promisedAt": string | null,
      "expectedAt": string | null,
      "dateConfidence": "certain" | "uncertain" | "none",
      "evidenceText": string | null,
      "confidence": number
    }
  ]
}
Rules:
- A commitment means the SENDER (or another third party) promises to do or deliver something for the recipient: "I'll send the report", "we can schedule the inspection", "the documents will be ready by Friday".
- Do NOT extract tasks the recipient must do themselves. If the recipient owes the sender something, that is not a waiting item.
- One entry per distinct deliverable (as-built documents, city revision, and inspections are three items).
- ownerName: the person responsible; fall back to the sender's name. ownerOrg: their company/agency when clear; else null.
- promisedAt: the date the promise was made (YYYY-MM-DD), usually the email date.
- expectedAt: a delivery date ONLY when explicitly stated ("by Friday", "within 2 weeks" — resolve relative dates using today). Never guess or invent a deadline. If none is stated, set expectedAt null and dateConfidence "none".
- dateConfidence "certain" only when an explicit date is stated; "uncertain" for vague timing ("soon", "next weekish"); "none" when no timing at all.
- evidenceText: a short exact quote from the email supporting the promise.
- confidence is 0-1. Use >= 0.7 only when the promise to deliver is explicit.
- Ignore newsletters, marketing, receipts, and generic pleasantries ("talk soon", "let me know").
- If there are no commitments, return {"commitments": []}.`;
