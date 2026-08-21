import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FlipperForceAuthError,
  clearFlipperForceCache,
  fetchFlipperForceAccount,
  fetchFlipperForceProjects,
  flipperforceConnector,
  formatUsd,
  matchFlipperForceProject,
  projectToRawRecord,
  resolveFlipperForceApiKey,
} from "./flipperforce";

describe("flipperforce helpers", () => {
  afterEach(() => {
    clearFlipperForceCache();
    vi.unstubAllGlobals();
    delete process.env.FLIPPERFORCE_API_KEY;
  });

  it("resolves apiKey from settings before env", () => {
    process.env.FLIPPERFORCE_API_KEY = "env-key";
    expect(resolveFlipperForceApiKey({ apiKey: "ui-key" })).toBe("ui-key");
    expect(resolveFlipperForceApiKey({})).toBe("env-key");
  });

  it("formats money with two decimals", () => {
    expect(formatUsd(515.39)).toBe("$515.39");
    expect(formatUsd(-12)).toBe("-$12.00");
  });

  it("matches projects by street fragments", () => {
    const projects = [
      {
        uuid: "a",
        workspaceUuid: "w",
        name: "779 NW 41st",
        fullAddress: "779 Northwest 41st Street, Miami, FL",
        address1: "779 Northwest 41st Street",
        city: "Miami",
        state: "FL",
        stage: "rehab",
        investmentStrategy: "fix_and_flip",
        updatedAt: null,
      },
    ];
    expect(matchFlipperForceProject("779 Northwest 41st Street", projects)?.uuid).toBe("a");
    expect(matchFlipperForceProject("grocery list", projects)).toBeNull();
  });

  it("normalizes project summaries without dumping expenses", async () => {
    const raw = projectToRawRecord({
      uuid: "p1",
      workspaceUuid: "w1",
      name: "779 NW 41st",
      fullAddress: "779 Northwest 41st Street",
      address1: "779 Northwest 41st Street",
      city: "Miami",
      state: "FL",
      stage: "rehab",
      investmentStrategy: "fix_and_flip",
      updatedAt: "2026-08-01T00:00:00Z",
    });
    const rows = await flipperforceConnector.normalize([raw]);
    expect(rows[0]?.recordType).toBe("flipperforce_project");
    expect(rows[0]?.externalId).toContain("p1");
    expect(flipperforceConnector.mapEvidence(rows[0]!).length).toBe(1);
  });

  it("treats 401 as auth failure and does not log the bearer token", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const auth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      expect(auth).toBe("Bearer secret-key");
      return new Response("nope", { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFlipperForceAccount("secret-key")).rejects.toBeInstanceOf(
      FlipperForceAuthError,
    );
  });

  it("parses project list payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                uuid: "p1",
                name: "779 NW 41st",
                full_address: "779 Northwest 41st Street",
                workspace_uuid: "w1",
                stage: "rehab",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const projects = await fetchFlipperForceProjects("k");
    expect(projects).toHaveLength(1);
    expect(projects[0]?.uuid).toBe("p1");
  });
});
