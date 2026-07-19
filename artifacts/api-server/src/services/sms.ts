import Twilio from "twilio";
import { logger } from "../lib/logger";

/**
 * Outbound SMS via Twilio. Disabled (no-op, logs a warning) until
 * TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / a from-number are configured — the
 * rest of the app (settings UI, reminder sweep) works either way, it just
 * won't actually deliver a text until these are set.
 */
export interface SmsService {
  readonly enabled: boolean;
  sendSms(input: { to: string; body: string }): Promise<{ sid: string | null }>;
}

class DisabledSmsService implements SmsService {
  readonly enabled = false;

  async sendSms(): Promise<{ sid: string | null }> {
    logger.warn(
      "SMS reminders are not configured (missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER) — skipping send.",
    );
    return { sid: null };
  }
}

class TwilioSmsService implements SmsService {
  readonly enabled = true;
  private readonly client: ReturnType<typeof Twilio>;

  constructor(
    accountSid: string,
    authToken: string,
    private readonly fromNumber: string,
  ) {
    this.client = Twilio(accountSid, authToken);
  }

  async sendSms(input: { to: string; body: string }): Promise<{ sid: string | null }> {
    const message = await this.client.messages.create({
      to: input.to,
      from: this.fromNumber,
      body: input.body,
    });
    return { sid: message.sid };
  }
}

export function createSmsService(): SmsService {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!accountSid || !authToken || !fromNumber) {
    return new DisabledSmsService();
  }
  return new TwilioSmsService(accountSid, authToken, fromNumber);
}

export const smsService: SmsService = createSmsService();
