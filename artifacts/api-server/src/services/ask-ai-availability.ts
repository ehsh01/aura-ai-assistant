import { aiService } from "./ai";
import { userAiAllowance } from "./ai-usage";

export type AskAiAvailability =
  | { allowed: true; model: string | null; reason: null }
  | {
      allowed: false;
      model: string | null;
      reason: "disabled" | "unavailable" | "daily_limit";
    };

export async function askAiAvailabilityForUser(
  userId: string,
): Promise<AskAiAvailability> {
  const status = aiService.getStatus();
  if (process.env.RECALL_ASK_AI_ENABLED?.trim().toLowerCase() === "false") {
    return { allowed: false, model: status.model, reason: "disabled" };
  }
  if (!status.enabled) {
    return { allowed: false, model: status.model, reason: "unavailable" };
  }
  const allowance = await userAiAllowance("ask_query", userId);
  if (!allowance.allowed) {
    return { allowed: false, model: status.model, reason: allowance.reason };
  }
  return { allowed: true, model: status.model, reason: null };
}
