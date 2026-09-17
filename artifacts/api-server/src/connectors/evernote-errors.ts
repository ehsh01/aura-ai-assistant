export type EvernoteConnectFailureReason =
  | "plan_required"
  | "oauth_failed";

export function evernoteMcpFailureReason(
  error: unknown,
): EvernoteConnectFailureReason {
  let message = "";
  if (error instanceof Error) {
    message = error.message;
  } else {
    try {
      message = JSON.stringify(error);
    } catch {
      message = String(error ?? "");
    }
  }
  return /\b(paid|plan|subscription|eligible|eligibility|upgrade)\b/i.test(
    message,
  )
    ? "plan_required"
    : "oauth_failed";
}
