/**
 * Single notification policy. Existing sweeps stay the source of "what to send";
 * this only answers whether a send is allowed. Defaults preserve current behavior.
 */

export type NotificationKind = "reminder" | "briefing" | "inbound_reply" | "uncertain";

export type NotificationPolicyInput = {
  kind: NotificationKind;
  /** 0–1. Uncertain items must never interrupt. */
  confidence?: number | null;
  inQuietHours: boolean;
  /** User already opened Today / saw this item. */
  alreadySeen?: boolean;
  /** Explicit user reply (inbound SMS) always allowed. */
  userInitiated?: boolean;
};

export type NotificationDecision = {
  allow: boolean;
  reason: string;
};

const UNCERTAIN_MAX = 0.55;

export function shouldNotify(input: NotificationPolicyInput): NotificationDecision {
  if (input.userInitiated) {
    return { allow: true, reason: "user_initiated" };
  }
  if (input.kind === "uncertain" || (input.confidence != null && input.confidence < UNCERTAIN_MAX)) {
    return { allow: false, reason: "uncertain" };
  }
  if (input.alreadySeen && input.kind !== "reminder") {
    return { allow: false, reason: "already_seen" };
  }
  if (input.inQuietHours && input.kind !== "reminder") {
    return { allow: false, reason: "quiet_hours" };
  }
  return { allow: true, reason: "ok" };
}
