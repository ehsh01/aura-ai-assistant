import { describe, expect, it } from "vitest";
import {
  backfillGmailPlanWithNamedPerson,
  extractGmailDateConstraint,
  isEmailSearchIntent,
  planGmailSearchHeuristic,
  planGmailSearchKeywords,
} from "./nl-gmail-query";
import { buildGmailSearchQuery, extractMailPersonName } from "./connectors";

describe("isEmailSearchIntent", () => {
  it("detects mail asks and rejects finance", () => {
    expect(isEmailSearchIntent("find the email from Nancy about the permit")).toBe(
      true,
    );
    expect(isEmailSearchIntent("did nancy email me last week")).toBe(true);
    expect(isEmailSearchIntent("How much did I spend?")).toBe(false);
  });
});

describe("extractGmailDateConstraint", () => {
  it("parses spoken dates", () => {
    expect(extractGmailDateConstraint("on Apr 23, 2026")).toContain("after:");
    expect(extractGmailDateConstraint("yesterday")).toBe("newer_than:2d");
    expect(extractGmailDateConstraint("last week")).toBe("newer_than:7d");
  });
});

describe("planGmailSearchHeuristic", () => {
  it("combines person + topic + date", () => {
    const planned = planGmailSearchHeuristic(
      "find the email from Nancy Bryant about the permit on Apr 23, 2026",
    );
    expect(planned).not.toBeNull();
    expect(planned!.query).toContain("from:Bryant");
    expect(planned!.query.toLowerCase()).toContain("permit");
    expect(planned!.query).toContain("after:");
    expect(planned!.personName?.toLowerCase()).toContain("nancy");
  });

  it("still handles classic from phrasing", () => {
    const planned = planGmailSearchHeuristic(
      "Okay, look for emails from Nancy Bryant.",
    );
    expect(planned?.query).toContain("from:(Nancy Bryant)");
  });
});

describe("planGmailSearchKeywords", () => {
  it("keeps useful tokens when phrasing is messy", () => {
    const planned = planGmailSearchKeywords(
      "please look for emails about 779 NW 41 ST",
    );
    expect(planned?.query.toLowerCase()).toContain("779");
  });
});

describe("buildGmailSearchQuery compat", () => {
  it("builds broad from queries", () => {
    const q = buildGmailSearchQuery("Okay, look for emails from Nancy Bryant.");
    expect(q).toContain("from:(Nancy Bryant)");
    expect(q).toContain("from:Bryant");
  });
});

describe("extractMailPersonName", () => {
  it("handles sent-by phrasing", () => {
    expect(
      extractMailPersonName("the email Nancy Bryant sent on April 23"),
    ).toBe("Nancy Bryant");
  });
});

describe("backfillGmailPlanWithNamedPerson", () => {
  it("resolves relationship phrasing ('my wife') that the planner cannot name", () => {
    // Simulates "when was my wife's last email": neither heuristic nor AI
    // planning finds a person, so the raw plan has no personName.
    const rawPlan = planGmailSearchKeywords("when was my wife's last email");
    expect(rawPlan?.personName).toBeNull();

    const backfilled = backfillGmailPlanWithNamedPerson(
      rawPlan,
      { displayName: "Sandra Hernandez", email: "sandra@example.com" },
      "when was my wife's last email",
    );

    expect(backfilled).not.toBeNull();
    expect(backfilled!.personName).toBe("Sandra Hernandez");
    expect(backfilled!.query).toContain("from:sandra@example.com");
    expect(backfilled!.query).toContain("from:Sandra");
    expect(backfilled!.query).toContain("from:Hernandez");
  });

  it("does not override a person the planner already resolved", () => {
    const plan = planGmailSearchHeuristic("emails from Nancy Bryant");
    const backfilled = backfillGmailPlanWithNamedPerson(plan, {
      displayName: "Sandra Hernandez",
    });
    expect(backfilled?.personName?.toLowerCase()).toContain("nancy");
  });

  it("adds a date constraint when the question mentions one", () => {
    const backfilled = backfillGmailPlanWithNamedPerson(
      null,
      { displayName: "Sandra Hernandez" },
      "did my wife email me yesterday",
    );
    expect(backfilled?.query).toContain("newer_than:2d");
  });

  it("passes through unchanged when no person is resolved", () => {
    const plan = planGmailSearchKeywords("find the permit email");
    expect(backfillGmailPlanWithNamedPerson(plan, null)).toBe(plan);
    expect(backfillGmailPlanWithNamedPerson(null, undefined)).toBeNull();
  });
});
