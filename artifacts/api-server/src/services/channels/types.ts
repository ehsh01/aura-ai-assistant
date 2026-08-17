/**
 * Channel adapters — thin I/O around the existing Voice First / capture pipeline.
 * Domain logic must not learn "this came from SMS".
 */

export type ChannelId = "pwa" | "sms" | "ask" | "extension" | "share" | "homey";

export type ChannelConfirmationStyle = "tap" | "reply_yes" | "none";

export type ChannelMessage = {
  channel: ChannelId;
  userId: string;
  text: string;
  sessionId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
};

export type ChannelReply = {
  text: string;
  confirmationStyle: ChannelConfirmationStyle;
  proposalId?: string | null;
};
