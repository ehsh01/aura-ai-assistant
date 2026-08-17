/**
 * Deterministic SMS command parser. No model calls — cheap, testable, safe.
 */

export type SmsCommand =
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "done" }
  | { kind: "snooze"; preset: "1d" | "3d" | "1w"; untilText: string | null }
  | { kind: "choice"; index: 1 | 2 | 3 }
  | { kind: "remember"; text: string }
  | { kind: "free_text"; text: string };

const CONFIRM_RE = /^(yes|y|ok|okay|confirm|do it|go ahead|sure|yep|yeah)\.?$/i;
const CANCEL_RE = /^(no|n|cancel|stop|nevermind|never mind|nope)\.?$/i;
const DONE_RE = /^(done|resolved|complete|completed|got it|finished)\.?$/i;
const SNOOZE_RE = /^(?:snooze)(?:\s+(?:until|to|for)\s+|\s+)?(.*)$/i;
const CHOICE_RE = /^([123])\.?$/;
const REMEMBER_RE = /^(?:remember(?:\s+that)?|teach)\s*[:\-]?\s+(.+)$/i;

export function parseSmsCommand(raw: string): SmsCommand {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return { kind: "free_text", text: "" };
  if (CONFIRM_RE.test(text)) return { kind: "confirm" };
  if (CANCEL_RE.test(text)) return { kind: "cancel" };
  if (DONE_RE.test(text)) return { kind: "done" };
  const choice = CHOICE_RE.exec(text);
  if (choice) return { kind: "choice", index: Number(choice[1]) as 1 | 2 | 3 };
  const remember = REMEMBER_RE.exec(text);
  if (remember?.[1]?.trim()) return { kind: "remember", text: remember[1].trim() };
  const snooze = SNOOZE_RE.exec(text);
  if (snooze) {
    const untilText = snooze[1]?.trim() || null;
    const lower = (untilText ?? "").toLowerCase();
    let preset: "1d" | "3d" | "1w" = "3d";
    if (/\b(week|7\s*days?)\b/.test(lower)) preset = "1w";
    else if (/\b(tomorrow|1\s*day|day)\b/.test(lower)) preset = "1d";
    return { kind: "snooze", preset, untilText };
  }
  return { kind: "free_text", text };
}

export function compactSmsAnswer(answer: string, max = 320): string {
  const clean = answer.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}
