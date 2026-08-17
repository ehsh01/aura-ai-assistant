import { Router, type IRouter } from "express";
import twilio from "twilio";
import { config } from "../lib/config";
import { handleInboundSms } from "../services/channels/sms-inbound";

const router: IRouter = Router();

function twiml(message: string): string {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${
    escaped ? `<Message>${escaped}</Message>` : ""
  }</Response>`;
}

function validTwilioSignature(req: { headers: Record<string, unknown>; body: unknown }): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!authToken) return false;
  const signature = req.headers["x-twilio-signature"];
  if (typeof signature !== "string" || !signature) return false;
  const url = `${config.appPublicUrl.replace(/\/$/, "")}/api/webhooks/twilio/sms`;
  const params = (req.body ?? {}) as Record<string, string>;
  try {
    return twilio.validateRequest(authToken, signature, url, params);
  } catch {
    return false;
  }
}

/**
 * Twilio inbound SMS. No session cookie.
 * Auth: X-Twilio-Signature when TWILIO_AUTH_TOKEN is set.
 * Replies only if the From number matches a user with inbound SMS enabled.
 */
router.post("/webhooks/twilio/sms", async (req, res, next) => {
  try {
    if (process.env.TWILIO_AUTH_TOKEN?.trim() && !validTwilioSignature(req)) {
      res.status(403).type("text/plain").send("Forbidden");
      return;
    }
    const from = typeof req.body?.From === "string" ? req.body.From : "";
    const body = typeof req.body?.Body === "string" ? req.body.Body : "";
    const sid = typeof req.body?.MessageSid === "string" ? req.body.MessageSid : null;
    if (!from) {
      res.status(400).type("text/xml").send(twiml(""));
      return;
    }
    const result = await handleInboundSms({ from, body, messageSid: sid });
    res.status(result.status === 429 ? 429 : 200).type("text/xml").send(twiml(result.reply));
  } catch (err) {
    next(err);
  }
});

export default router;
