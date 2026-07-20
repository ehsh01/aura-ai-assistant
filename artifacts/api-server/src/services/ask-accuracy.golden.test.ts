import { describe, expect, it } from "vitest";
import { detectAskAmbiguity, repairDateTypos } from "./ask-ambiguity";
import { routeSourcePlan } from "./source-router";
import {
  confidenceFromSources,
  isRelationLiteral,
} from "./ask-accuracy-policy";
import { verifyFinanceAmountsInAnswer } from "./ask-verifier";
import { backfillGmailPlanWithNamedPerson } from "./nl-gmail-query";
import { extractPayeeHint } from "./finance-sync";
import { parseFinanceDateRange, todayIso } from "./query-utils";

describe("ask accuracy golden — production regressions", () => {
  it("repairs yeaterday typo before finance date parse", () => {
    const repaired = repairDateTypos(
      "how much money did i spent yeaterday in total",
    );
    expect(repaired.repairedTo).toBe("yesterday");
    const today = "2026-07-20";
    const range = parseFinanceDateRange(repaired.text, today);
    expect(range.label).toBe("yesterday");
    expect(range.startDate).toBe("2026-07-19");
  });

  it("does not treat 'any' as a payee (false $0 spent)", () => {
    expect(extractPayeeHint("did I spend any money today?")).toBeNull();
  });

  it("routes spend questions to deterministic finance", () => {
    const plan = routeSourcePlan("how much did I spend yesterday?");
    expect(plan.required).toContain("finance");
    expect(plan.answerMode).toBe("deterministic_total");
  });

  it("routes last-email questions to deterministic email", () => {
    const plan = routeSourcePlan("when was my wife's last email");
    expect(plan.required).toContain("gmail");
    expect(plan.answerMode).toBe("deterministic_email");
  });

  it("overrides relation literal personName with resolved People contact", () => {
    const backfilled = backfillGmailPlanWithNamedPerson(
      {
        query: "(from:wife)",
        personName: "wife",
        source: "ai",
      },
      { displayName: "Sandra Hernandez", email: "sandra@example.com" },
      "when was my wife's last email",
    );
    expect(backfilled?.personName).toBe("Sandra Hernandez");
    expect(backfilled?.query).toContain("from:sandra@example.com");
    expect(isRelationLiteral("wife")).toBe(true);
  });

  it("clarifies unparseable date-like tokens", () => {
    const amb = detectAskAmbiguity("how much did I spend yestfoo?");
    expect(amb.needsClarify).toBe(true);
  });

  it("rejects invented dollar amounts in verifier", () => {
    const check = verifyFinanceAmountsInAnswer("You spent $999.99 today.", [
      "$55.94",
      "$0.00",
    ]);
    expect(check.ok).toBe(false);
  });

  it("allows amounts present in finance evidence", () => {
    const check = verifyFinanceAmountsInAnswer("You spent $55.94 today.", [
      "$55.94",
    ]);
    expect(check.ok).toBe(true);
  });

  it("never assigns High confidence when connector is missing", () => {
    const v = confidenceFromSources({
      requiredOk: false,
      requiredEmptyAfterSafeFilter: false,
      stale: false,
      connectorMissing: true,
      authError: false,
      hasGrounding: false,
    });
    expect(v.confidence).toBeLessThan(0.8);
  });

  it("todayIso is stable shape", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
