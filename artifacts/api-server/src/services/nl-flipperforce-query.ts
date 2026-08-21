/**
 * Heuristic planner for FlipperForce Ask (projects, activity, rehab reports).
 * Household spend questions stay on the finance connector — this only matches
 * FlipperForce / property-rehab language.
 */

export type FlipperForceAskPlan =
  | { intent: "inventory"; hint: string | null }
  | { intent: "activity"; hint: string | null }
  | { intent: "report"; hint: string | null }
  | { intent: "search"; hint: string | null }
  | null;

const EXPLICIT =
  /\b(flipper\s*force|flipperforce)\b/i;

const DOMAIN =
  /\b(rehab|wholesale|wholetail|fix\s*(?:and|&)\s*flip|house\s*flip|flipping|investment\s*propert(?:y|ies)|photo\s*log|before\s*photos|turn[- ]on\s+utilities|pipeline\s+stage)\b/i;

const STREET =
  /\b\d{2,5}\s+(?:(?:n\.?\s*w\.?|n\.?\s*e\.?|s\.?\s*w\.?|s\.?\s*e\.?|northwest|northeast|southwest|southeast|north|south|east|west|nw|ne|sw|se)\s+)?[a-z0-9.'-]+\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl|terrace|ter)\b/i;

const PROJECTISH =
  /\b(property|properties|deal|deals|flip\b|rehab\b)\b/i;

const ACTIVITY =
  /\b(activity|what(?:'s| is) going on|overdue|digest|what changed|updates?|tasks?)\b/i;

const REPORT =
  /\b(p\s*&\s*l|profit|loss|expenses?|income|spent on|rehab cost|how much.*(project|property|rehab|flip)|report)\b/i;

const INVENTORY =
  /\b(list|show|which|what)\b.*\b(projects?|properties|deals|flips)\b|\b(projects?|properties|deals)\b.*\b(list|have|do i)\b/i;

const STOP =
  /\b(please|okay|ok|hey|can you|could you|would you|i need|i want|help me|for me|in my|my|the|a|an|of|to|and|or|just|really|also|about|flipperforce|flipper force|project|property|rehab)\b/gi;

export function isFlipperForceAskIntent(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (EXPLICIT.test(q)) return true;
  if (DOMAIN.test(q)) return true;
  if (STREET.test(q) && (PROJECTISH.test(q) || REPORT.test(q) || ACTIVITY.test(q) || EXPLICIT.test(q))) {
    return true;
  }
  if (STREET.test(q) && !/\b(spend|spent|grocery|groceries|amazon|walmart|budget)\b/i.test(q)) {
    return true;
  }
  return false;
}

function extractHint(question: string): string | null {
  const street = question.match(STREET)?.[0]?.trim();
  if (street) return street;
  const cleaned = question
    .replace(EXPLICIT, " ")
    .replace(STOP, " ")
    .replace(/[?!.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 3 ? cleaned.slice(0, 80) : null;
}

export function planFlipperForceAsk(question: string): FlipperForceAskPlan {
  if (!isFlipperForceAskIntent(question)) return null;
  const hint = extractHint(question);
  if (REPORT.test(question)) return { intent: "report", hint };
  if (ACTIVITY.test(question) && !INVENTORY.test(question)) return { intent: "activity", hint };
  if (INVENTORY.test(question)) return { intent: "inventory", hint };
  if (hint && STREET.test(question)) return { intent: "search", hint };
  if (hint) return { intent: "search", hint };
  return { intent: "inventory", hint: null };
}
