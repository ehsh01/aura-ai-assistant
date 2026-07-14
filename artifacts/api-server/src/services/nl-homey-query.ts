/**
 * Heuristic + lightweight AI planning for Homey Ask status/control.
 */

export type HomeyAskPlan =
  | {
      intent: "status";
      deviceHint: string | null;
      capabilityHint: string | null;
    }
  | {
      intent: "inventory";
      classHint: string | null;
      nameHint: string | null;
    }
  | {
      intent: "control";
      deviceHint: string | null;
      capabilityHint: string | null;
      value: boolean | number | string | null;
      risky: boolean;
      confirmed: boolean;
    }
  | {
      intent: "flow";
      flowHint: string | null;
      confirmed: boolean;
    }
  | null;

const HOMEY_INTENT =
  /\b(homey|smart\s*home|lights?|light|lamp|bulbs?|lock|unlock|door|garage|thermostat|ac|hvac|heat(?:ing)?|cool(?:ing)?|fan|blinds?|curtain|sensor|leak|smoke|alarm|flow|scene|away\s*mode|porch|hallway)\b/i;

const CONTROL_INTENT =
  /\b(turn\s+(on|off)|switch\s+(on|off)|set|lock|unlock|open|close|start|trigger|run|activate|dim)\b/i;

const STATUS_INTENT =
  /\b(is|are|status|state|what(?:'s| is)|check|how\s+(?:warm|cold|hot)|temperature|open|closed|locked|unlocked|on|off)\b/i;

const CONFIRM =
  /\b(confirm(?:ed)?|yes[,.]?\s*(do\s+it|please)?|go\s+ahead|proceed)\b/i;

const FILLER =
  /\b(please|okay|ok|hey|can you|could you|would you|i need|i want|help me|for me|in my|my|the|a|an|of|to|and|or|just|really|also|about|homey|smart home)\b/gi;

export function isHomeyAskIntent(text: string): boolean {
  const q = text.trim();
  if (!q) return false;
  return HOMEY_INTENT.test(q);
}

function extractDeviceHint(text: string): string | null {
  const cleaned = text
    .replace(FILLER, " ")
    .replace(CONTROL_INTENT, " ")
    .replace(/\b(is|are|status|state|what|check|confirm(?:ed)?|yes|go ahead|proceed)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2) return null;
  // Prefer quoted name
  const quoted = text.match(/["“](.+?)["”]/);
  if (quoted?.[1]) return quoted[1].trim();
  return cleaned.slice(0, 80) || null;
}

function inferCapabilityAndValue(
  text: string,
): { capability: string | null; value: boolean | number | string | null; risky: boolean } {
  const lower = text.toLowerCase();
  if (/\bunlock\b/.test(lower)) return { capability: "locked", value: false, risky: true };
  if (/\block\b/.test(lower) && !/\bunlock\b/.test(lower)) {
    return { capability: "locked", value: true, risky: true };
  }
  if (/\b(turn|switch)\s+off\b/.test(lower) || /\boff\b/.test(lower)) {
    return { capability: "onoff", value: false, risky: false };
  }
  if (/\b(turn|switch)\s+on\b/.test(lower) || /\bon\b/.test(lower)) {
    return { capability: "onoff", value: true, risky: false };
  }
  if (/\b(open)\b/.test(lower) && /\b(garage|door|gate)\b/.test(lower)) {
    return { capability: "garagedoor_closed", value: false, risky: true };
  }
  if (/\b(close)\b/.test(lower) && /\b(garage|door|gate)\b/.test(lower)) {
    return { capability: "garagedoor_closed", value: true, risky: true };
  }
  const temp = lower.match(/\b(set|to)\s+(\d{2})\b/);
  if (temp && /\b(temp|thermostat|heat|cool|degrees?)\b/.test(lower)) {
    return { capability: "target_temperature", value: Number(temp[2]), risky: false };
  }
  return { capability: null, value: null, risky: false };
}

export function planHomeyAsk(question: string): HomeyAskPlan {
  const q = question.trim();
  if (!q || !isHomeyAskIntent(q)) return null;

  const confirmed = CONFIRM.test(q);
  const wantsControl = CONTROL_INTENT.test(q);
  const wantsStatus = STATUS_INTENT.test(q);
  // Prefer status for interrogatives ("is the garage door open?") over control verbs that share words like "open".
  const interrogative =
    /^(is|are|was|were|what|what's|whats|how|check)\b/i.test(q) ||
    /\?\s*$/.test(q);
  const wantsFlow =
    /\b(flow|scene|away\s*mode|good\s*night|i'?m\s+home|leaving)\b/i.test(q) &&
    wantsControl;

  const wantsInventory =
    /\b(how\s+many|list|count|which|what\s+.+\s+(do\s+i\s+have|are\s+there))\b/i.test(q) ||
    /\b(sensors?|devices?)\b/i.test(q) &&
      /\b(have|own|connected|in\s+(my|the)\s+home)\b/i.test(q);

  if (wantsFlow) {
    return {
      intent: "flow",
      flowHint: extractDeviceHint(q),
      confirmed,
    };
  }

  if (wantsInventory && !(wantsControl && !interrogative)) {
    let classHint: string | null = null;
    if (/\b(door|contact)\b/i.test(q)) classHint = "door";
    else if (/\b(window)\b/i.test(q)) classHint = "window";
    else if (/\b(lock)\b/i.test(q)) classHint = "lock";
    else if (/\b(light|lamp|bulb)\b/i.test(q)) classHint = "light";
    else if (/\b(sensor)\b/i.test(q)) classHint = "sensor";
    else if (/\b(garage)\b/i.test(q)) classHint = "garage";
    return {
      intent: "inventory",
      classHint,
      nameHint: extractDeviceHint(q),
    };
  }

  if (wantsControl && !(interrogative && wantsStatus)) {
    const { capability, value, risky } = inferCapabilityAndValue(q);
    return {
      intent: "control",
      deviceHint: extractDeviceHint(q),
      capabilityHint: capability,
      value,
      risky: risky || /all\s+(lights?|devices?)|whole\s+house|everything/i.test(q),
      confirmed,
    };
  }

  if (wantsStatus || HOMEY_INTENT.test(q)) {
    const { capability } = inferCapabilityAndValue(q);
    return {
      intent: "status",
      deviceHint: extractDeviceHint(q),
      capabilityHint:
        capability ??
        (/\btemp|warm|cold|hot|degrees?\b/i.test(q)
          ? "measure_temperature"
          : /\block|door\b/i.test(q)
            ? "locked"
            : /\blight|lamp|on|off\b/i.test(q)
              ? "onoff"
              : null),
    };
  }

  return null;
}

export function matchHomeyName(
  hint: string | null,
  candidates: { id: string; name: string }[],
): { id: string; name: string } | null {
  if (!hint || !candidates.length) return null;
  const h = hint.toLowerCase();
  const exact = candidates.find((c) => c.name.toLowerCase() === h);
  if (exact) return exact;
  const includes = candidates.filter((c) => {
    const n = c.name.toLowerCase();
    return n.includes(h) || h.includes(n);
  });
  if (includes.length === 1) return includes[0]!;
  // Score by token overlap
  const tokens = h.split(/\s+/).filter((t) => t.length > 2);
  let best: { id: string; name: string; score: number } | null = null;
  for (const c of candidates) {
    const n = c.name.toLowerCase();
    let score = 0;
    for (const t of tokens) if (n.includes(t)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { ...c, score };
  }
  return best ? { id: best.id, name: best.name } : null;
}
