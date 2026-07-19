import { aiService } from "./ai";
import {
  FINANCE_INTENT,
  PERSON_INTENT,
  WAITING_INTENT,
  NOTE_CAPABILITY_INTENT,
} from "./query-utils";
import { isEmailSearchIntent } from "./nl-gmail-query";
import {
  classifyIntentResultSchema,
  type ClassifyIntentResult,
  type IntentKind,
} from "../prompts/classifyIntent.v1";

/**
 * Intent Router (Milestone 1)
 *
 * Decides whether a single free-form Ask input should be ANSWERED (routed to the
 * existing Ask query engine) or REMEMBERED/ACTED ON (routed to the existing
 * capture pipeline / AI Inbox). It never performs the side effect itself.
 *
 * Cost model (per plan): a zero-cost regex fast-path runs first and resolves
 * only CLEAR cases. Anything ambiguous falls through to a single cheap-model
 * call (`gpt-4o-mini`). Model failure / low confidence safe-defaults to the AI
 * Inbox (capture) with `requiresConfirmation`, so nothing is silently answered
 * wrong and the raw input is always preserved.
 */

export type IntentRoute = "question" | "capture";

/** Below this model confidence we do not trust the answer; safe-default to inbox. */
const LOW_CONFIDENCE = 0.5;

export interface IntentRouteDecision {
  route: IntentRoute;
  result: ClassifyIntentResult;
  /** Which layer decided: the zero-cost regex fast-path or the model. */
  source: "regex" | "model";
  /** True when the model was unavailable/failed and we fell back. */
  degraded: boolean;
}

/** Question intents map to the Ask engine; everything else is captured for review. */
function routeFromIntent(intent: IntentKind): IntentRoute {
  return intent === "question" || intent === "finance_question" ? "question" : "capture";
}

/** Shape heuristic — does the text read like a question? Never punctuation-only. */
function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const startsInterrogative =
    /^(who|what|whats|what's|when|where|why|how|which|whose|whom|do|does|did|is|are|was|were|can|could|should|would|will|have|has|had|am|may|might)\b/i.test(
      t,
    );
  // A trailing "?" is a hint but not sufficient on its own; require it to also
  // not begin with an explicit capture/imperative cue (handled by the caller).
  const endsWithQuestionMark = /\?\s*$/.test(t);
  return startsInterrogative || endsWithQuestionMark;
}

/** Explicit "file this / remind me / do this" leads that clearly mean capture. */
const CAPTURE_LEAD =
  /^(remember(\s+(that|to))?\b|note\s+(that|to\s+self)\b|note:\s|fyi\b|save\s+this\b|log\s+(that|this)\b|jot\s+(this|that|it)?\s*down\b|keep\s+this\b|remind\s+me\b|to-?do\b|add\s+(a\s+)?(task|reminder|note|memory)\b)/i;

/**
 * Zero-cost classification for CLEAR inputs only. Returns null when the input is
 * ambiguous (both/neither signal), deferring to the model. Exported for tests.
 */
export function regexFastPath(text: string): ClassifyIntentResult | null {
  const t = text.trim();
  if (!t) return null;

  const hasCaptureLead = CAPTURE_LEAD.test(t);
  const isQuestion = looksLikeQuestion(t);

  // Clear capture: explicit lead and not phrased as a question.
  if (hasCaptureLead && !isQuestion) {
    const isReminder = /^remind\s+me\b/i.test(t);
    return {
      primaryIntent: isReminder ? "reminder" : "capture",
      secondaryIntents: [],
      confidence: 0.9,
      requiresConfirmation: false,
      containsQuestion: false,
      containsAction: isReminder || /^(add\s+(a\s+)?task|to-?do)\b/i.test(t),
      containsDurableFact: /^remember\b/i.test(t),
      containsDeadline: isReminder,
      containsAttachment: false,
      reason: "regex: explicit capture lead",
    };
  }

  // Clear question: interrogative shape and no capture lead.
  if (isQuestion && !hasCaptureLead) {
    const finance = FINANCE_INTENT.test(t);
    const emaily = isEmailSearchIntent(t);
    const person = PERSON_INTENT.test(t);
    const waiting = WAITING_INTENT.test(t);
    const capability = NOTE_CAPABILITY_INTENT.test(t);
    const secondary: IntentKind[] = [];
    if (waiting) secondary.push("waiting_on");
    return {
      primaryIntent: finance ? "finance_question" : "question",
      secondaryIntents: secondary,
      confidence: finance || emaily || person || capability || waiting ? 0.92 : 0.85,
      requiresConfirmation: false,
      containsQuestion: true,
      containsAction: false,
      containsDurableFact: false,
      containsDeadline: false,
      containsAttachment: false,
      reason: "regex: interrogative shape",
    };
  }

  // Ambiguous (both signals, or neither) → let the model decide.
  return null;
}

/**
 * Full routing decision. Regex fast-path first; cheap model only when needed.
 * Safe-defaults to the AI Inbox on low confidence or a degraded model.
 */
export async function routeIntentForText(text: string): Promise<IntentRouteDecision> {
  const fast = regexFastPath(text);
  if (fast) {
    return {
      route: routeFromIntent(fast.primaryIntent),
      result: fast,
      source: "regex",
      degraded: false,
    };
  }

  const { degraded, result } = await aiService.classifyIntent({ text });
  // Re-validate defensively even though the AI service already parsed it.
  const parsed = classifyIntentResultSchema.safeParse(result);
  const safe: ClassifyIntentResult = parsed.success
    ? parsed.data
    : {
        primaryIntent: "unknown",
        secondaryIntents: [],
        confidence: 0,
        requiresConfirmation: true,
        containsQuestion: false,
        containsAction: false,
        containsDurableFact: false,
        containsDeadline: false,
        containsAttachment: false,
        reason: "router: result failed schema validation",
      };

  const lowConfidence = safe.confidence < LOW_CONFIDENCE;
  if (degraded || lowConfidence || !parsed.success) {
    // Safe default: preserve the input in the AI Inbox for review rather than
    // risk answering the wrong thing.
    return {
      route: "capture",
      result: { ...safe, requiresConfirmation: true },
      source: "model",
      degraded: degraded || !parsed.success,
    };
  }

  return {
    route: routeFromIntent(safe.primaryIntent),
    result: safe,
    source: "model",
    degraded: false,
  };
}
