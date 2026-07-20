import {
  FINANCE_BREAKDOWN_INTENT,
  FINANCE_INTENT,
  FAMILY_RELATION_INTENT,
  PERSON_INTENT,
  WAITING_INTENT,
} from "./query-utils";
import { isEmailSearchIntent } from "./nl-gmail-query";
import { isDriveSearchIntent } from "./nl-drive-query";
import { isHomeyAskIntent } from "./nl-homey-query";
import { extractPayeeHint } from "./finance-sync";
import type { AskDomain } from "./ask-accuracy-policy";

export type AnswerMode =
  | "deterministic_total"
  | "deterministic_list"
  | "deterministic_email"
  | "deterministic_homey"
  | "grounded_llm"
  | "clarify";

export type SourcePlan = {
  domains: AskDomain[];
  required: AskDomain[];
  primary: AskDomain;
  constraints: {
    payee?: string | null;
    wantsLastEmail?: boolean;
  };
  answerMode: AnswerMode;
  rationale: string;
};

const LAST_EMAIL =
  /\b(last|latest|most\s+recent|newest)\b.*\b(email|e-?mail|mail|message)\b|\b(email|e-?mail|mail|message)\b.*\b(last|latest|most\s+recent|newest)\b/i;

/**
 * Rule-first Source Router. High-stakes domains (finance / gmail / homey)
 * get required sources and deterministic answer modes when possible.
 */
export function routeSourcePlan(question: string): SourcePlan {
  const q = question.trim();

  if (
    /\b(homey|smart\s*home)\b/i.test(q) ||
    isHomeyAskIntent(q)
  ) {
    return {
      domains: ["homey"],
      required: ["homey"],
      primary: "homey",
      constraints: {},
      answerMode: "deterministic_homey",
      rationale: "Homey / smart-home question",
    };
  }

  const wantsFinance = FINANCE_INTENT.test(q) || FINANCE_BREAKDOWN_INTENT.test(q);
  const wantsEmail = isEmailSearchIntent(q);
  const wantsDrive = isDriveSearchIntent(q);
  const wantsPerson = PERSON_INTENT.test(q) || FAMILY_RELATION_INTENT.test(q);
  const wantsWaiting = WAITING_INTENT.test(q);

  if (wantsFinance && !wantsEmail) {
    const payee = extractPayeeHint(q);
    const list = FINANCE_BREAKDOWN_INTENT.test(q);
    return {
      domains: ["finance"],
      required: ["finance"],
      primary: "finance",
      constraints: { payee },
      answerMode: list ? "deterministic_list" : "deterministic_total",
      rationale: list
        ? "Finance breakdown — deterministic list from MyFamilyBudget"
        : "Finance total — deterministic aggregate from MyFamilyBudget",
    };
  }

  if (wantsEmail) {
    const last = LAST_EMAIL.test(q);
    const domains: AskDomain[] = ["gmail"];
    if (wantsPerson) domains.push("people");
    return {
      domains,
      required: ["gmail"],
      primary: "gmail",
      constraints: { wantsLastEmail: last },
      answerMode: last ? "deterministic_email" : "grounded_llm",
      rationale: last
        ? "Last-email question — cite top live Gmail hit"
        : "Email search — live Gmail required",
    };
  }

  if (wantsDrive) {
    return {
      domains: ["drive"],
      required: ["drive"],
      primary: "drive",
      constraints: {},
      answerMode: "grounded_llm",
      rationale: "Drive search — live Google Drive required",
    };
  }

  if (wantsWaiting) {
    return {
      domains: ["waiting", "people", "notes"],
      required: ["waiting"],
      primary: "waiting",
      constraints: {},
      answerMode: "grounded_llm",
      rationale: "Waiting-on / follow-up question",
    };
  }

  if (wantsPerson) {
    return {
      domains: ["people", "notes"],
      required: [],
      primary: "people",
      constraints: {},
      answerMode: "grounded_llm",
      rationale: "Person / family question — People + notes + memories",
    };
  }

  if (wantsFinance && wantsEmail) {
    return {
      domains: ["finance", "gmail"],
      required: ["finance"],
      primary: "finance",
      constraints: { payee: extractPayeeHint(q) },
      answerMode: "deterministic_total",
      rationale: "Mixed finance+email — finance is primary",
    };
  }

  return {
    domains: ["notes", "people"],
    required: [],
    primary: "notes",
    constraints: {},
    answerMode: "grounded_llm",
    rationale: "General Ask — notes and people retrieval",
  };
}
