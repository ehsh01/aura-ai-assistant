import { expect, test, type Page, type Route } from "@playwright/test";

const now = "2026-10-17T12:00:00.000Z";
const localFeatureTarget =
  /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(
    process.env.E2E_BASE_URL?.replace(/\/$/, "") ?? "",
  );
const baseItems = [
  {
    id: "item-permit",
    kind: "note",
    state: "ready",
    source: "recall",
    title: "Permit revision",
    description: "City approval and next steps.",
    domain: null,
    sourceUrl: null,
    bodyText: "The permit revision was approved.",
    media: {},
    tags: ["permits", "year:2026"],
    notebook: "House Projects",
    trashed: false,
    bumpedAt: now,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "evernote-meeting",
    kind: "note",
    state: "ready",
    source: "evernote",
    title: "Sales meeting notes",
    description: null,
    domain: null,
    sourceUrl: "https://www.evernote.com/shard/example",
    bodyText: "Pipeline decisions from the sales meeting.",
    media: {},
    tags: ["sales", "notebook:work"],
    notebook: "Work",
    trashed: false,
    bumpedAt: now,
    createdAt: now,
    updatedAt: now,
  },
];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockRecall(
  page: Page,
  options: {
    graphSourceCount?: number;
    askAiAllowed?: boolean;
    denseNotebook?: boolean;
    notebookEdgeCap?: number;
  } = {},
) {
  const items = [...baseItems];
  const calls = { ai: 0, itemSearch: 0 };
  let graphMetrics: {
    sourceCount: number;
    returnedNodes: number;
    returnedEdges: number;
    nextOffset: number | null;
  } = {
    sourceCount: items.length,
    returnedNodes: 0,
    returnedEdges: 0,
    nextOffset: null,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/auth/me") {
      return json(route, {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "ernesto@example.com",
          name: "Ernesto",
          isAdmin: true,
        },
      });
    }
    if (url.pathname === "/api/notes") return json(route, { notes: [] });
    if (url.pathname === "/api/tasks") return json(route, { tasks: [] });
    if (url.pathname === "/api/notebooks")
      return json(route, { notebooks: [] });
    if (url.pathname === "/api/home") return json(route, { review: {} });
    if (url.pathname === "/api/ai/query/availability") {
      return json(route, {
        allowed: options.askAiAllowed !== false,
        model: options.askAiAllowed === false ? null : "gpt-4.1-mini",
        reason: options.askAiAllowed === false ? "disabled" : null,
      });
    }
    if (url.pathname === "/api/ai/query/stream") {
      calls.ai += 1;
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          'event: meta\ndata: {"threadId":"thread-1","evidence":[],"relatedRecords":[{"entityType":"item","entityId":"item-permit","title":"Permit revision"}]}\n\n',
          'event: token\ndata: {"delta":"**Permit approved.** "}\n\n',
          'event: token\ndata: {"delta":"The revision is ready."}\n\n',
          'event: done\ndata: {"answer":"**Permit approved.** The revision is ready.","confidence":0.9,"caveats":null,"evidence":[],"relatedRecords":[{"entityType":"item","entityId":"item-permit","title":"Permit revision"}],"images":[],"suggestedNextAction":null,"threadId":"thread-1"}\n\n',
        ].join(""),
      });
    }
    if (url.pathname === "/api/finance/refresh") {
      return json(route, { ok: true, synced: false, skipped: true });
    }
    if (url.pathname === "/api/items/facets") {
      return json(route, {
        tags: ["permits", "sales"],
        notebooks: ["House Projects", "Work"],
      });
    }
    if (url.pathname === "/api/items/graph") {
      const sourceCount = options.graphSourceCount ?? items.length;
      const requestedLimit = Math.min(
        Number(url.searchParams.get("limit") ?? 350),
        500,
      );
      if (options.denseNotebook) {
        const itemCount = Math.floor(requestedLimit * 0.8);
        const itemNodes = Array.from({ length: itemCount }, (_, index) => ({
          id: `item-node:dense-${index}`,
          itemId: items[index % items.length]!.id,
          type: index % 5 === 0 ? ("evernote" as const) : ("notes" as const),
          label: `Imported note ${index + 1}`,
          value: 4 + (index % 3),
          hub: false,
          href: `/everything/${items[index % items.length]!.id}`,
        }));
        const notebookHub = {
          id: "notebooks:dense-everything",
          itemId: null,
          type: "notebooks" as const,
          label: "Everything",
          value: 18,
          hub: true,
          href: "/everything?notebook=Everything",
        };
        const tagHubs = Array.from({ length: 8 }, (_, index) => ({
          id: `tags:dense-${index}`,
          itemId: null,
          type: "tags" as const,
          label: `Topic ${index + 1}`,
          value: 8,
          hub: true,
          href: "/everything",
        }));
        const notebookEdgeCount = Math.min(
          itemCount - 3,
          options.notebookEdgeCap ?? Number.POSITIVE_INFINITY,
        );
        const notebookEdges = itemNodes
          .slice(0, notebookEdgeCount)
          .map((node, index) => ({
            id: `dense-notebook-edge-${index}`,
            source: node.id,
            target: notebookHub.id,
            signal: "notebook" as const,
          }));
        const tagEdges = itemNodes
          .filter((_, index) => index % 29 === 0)
          .map((node, index) => ({
            id: `dense-tag-edge-${index}`,
            source: node.id,
            target: tagHubs[index % tagHubs.length]!.id,
            signal: "tag" as const,
          }));
        const graphNodes = [...itemNodes, notebookHub, ...tagHubs];
        const graphEdges = [...notebookEdges, ...tagEdges];
        const nextOffset = sourceCount > requestedLimit ? requestedLimit : null;
        graphMetrics = {
          sourceCount,
          returnedNodes: graphNodes.length,
          returnedEdges: graphEdges.length,
          nextOffset,
        };
        return json(route, {
          nodes: graphNodes,
          edges: graphEdges,
          page: {
            offset: 0,
            limit: requestedLimit,
            nextOffset,
            sourceCount,
          },
        });
      }
      const returnedNodes = Math.min(requestedLimit, sourceCount);
      const itemCount = Math.max(1, Math.floor(returnedNodes * 0.78));
      const hubCount = returnedNodes - itemCount;
      const graphNodes = [
        ...Array.from({ length: itemCount }, (_, index) => ({
          id: `item-node:synthetic-${index}`,
          itemId: items[index % items.length]!.id,
          type: (["notes", "evernote", "links", "files"] as const)[index % 4],
          label: `Synthetic item ${index + 1}`,
          value: 5 + (index % 9),
          hub: false,
          href: `/everything/${items[index % items.length]!.id}`,
        })),
        ...Array.from({ length: hubCount }, (_, index) => ({
          id: `${index % 2 ? "tags" : "notebooks"}:synthetic-${index}`,
          itemId: null,
          type: index % 2 ? ("tags" as const) : ("notebooks" as const),
          label: index % 4 < 2 ? "Finance" : "Vehicles",
          value: 10 + (index % 5),
          hub: true,
          href:
            index % 2
              ? "/everything?tag=finance"
              : "/everything?notebook=Finance",
        })),
      ];
      const firstHub = itemCount;
      const nextOffset = sourceCount > returnedNodes ? returnedNodes : null;
      graphMetrics = {
        sourceCount,
        returnedNodes: graphNodes.length,
        returnedEdges: itemCount,
        nextOffset,
      };
      return json(route, {
        nodes: graphNodes,
        edges: Array.from({ length: itemCount }, (_, index) => ({
          id: `edge-${index}`,
          source: `item-node:synthetic-${index}`,
          target: graphNodes[firstHub + (index % Math.max(1, hubCount))]?.id,
          signal: index % 2 ? "tag" : "notebook",
        })),
        page: {
          offset: 0,
          limit: requestedLimit,
          nextOffset,
          sourceCount,
        },
      });
    }
    if (url.pathname === "/api/items" && request.method() === "POST") {
      const payload = request.postDataJSON() as { value: string };
      const created = {
        ...baseItems[0],
        id: "item-created",
        title: payload.value,
        bodyText: payload.value,
        tags: ["year:2026"],
      };
      items.unshift(created);
      return json(route, { item: created, existing: false }, 201);
    }
    if (url.pathname === "/api/items" && request.method() === "GET") {
      calls.itemSearch += 1;
      const q = url.searchParams.get("q")?.toLowerCase();
      return json(route, {
        items: q
          ? items.filter((item) =>
              `${item.title} ${item.bodyText}`.toLowerCase().includes(q),
            )
          : items,
      });
    }
    if (url.pathname.startsWith("/api/items/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/items/".length));
      const item = items.find((candidate) => candidate.id === id);
      return item
        ? json(route, { item })
        : json(route, { message: "Not found" }, 404);
    }
    return json(route, {});
  });
  return { getGraphMetrics: () => graphMetrics, calls };
}

test.describe("Everything capture, graph, grid, and search", () => {
  test.skip(
    !localFeatureTarget,
    "Everything feature tests require the checked-out PR frontend, not deployed production",
  );

  test("saves a note, browses masonry, filters instantly, and opens detail", async ({
    page,
  }) => {
    await mockRecall(page);
    await page.goto("/");

    await expect(page.getByTestId("knowledge-graph")).toBeVisible();
    await expect(page.getByLabel("Save anything")).toBeVisible();

    await page.getByLabel("Save anything").fill("Contractor callback");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Saved to Recall", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Grid", exact: true }).click();
    await expect(page.getByTestId("masonry-grid")).toBeVisible();
    await expect(
      page
        .getByTestId("masonry-grid")
        .getByText("Contractor callback", { exact: true }),
    ).toBeVisible();

    await page.getByTestId("item-search").fill("permit");
    await expect(
      page.getByText("Permit revision", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Sales meeting notes", { exact: true }),
    ).toBeHidden();

    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await expect(page.getByTestId("search-filters")).toBeVisible();
    await page.getByText("Permit revision", { exact: true }).click();
    await expect(page.getByTestId("item-detail")).toContainText(
      "City approval",
    );
  });

  test("caps a 5,000-item source and remains responsive under 4x mobile CPU throttling", async ({
    context,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const metrics = await mockRecall(page, { graphSourceCount: 5_000 });

    await page.goto("/");
    await expect(page.getByTestId("knowledge-graph")).toBeVisible();
    await expect(page.getByLabel(/R\.E\.C\.A\.L\.L\. ready/i)).toBeVisible();
    const graphCanvas = page.getByLabel("Interactive knowledge graph");
    await expect(graphCanvas).toHaveAttribute("data-graph-nodes", "180");
    await expect
      .poll(async () =>
        Number((await graphCanvas.getAttribute("data-graph-edge-width")) ?? 0),
      )
      .toBeGreaterThanOrEqual(1.35);
    const glowWidth = Number(
      await graphCanvas.getAttribute("data-graph-edge-glow-width"),
    );
    expect(glowWidth).toBeGreaterThan(1.35);
    expect(glowWidth).toBeLessThanOrEqual(6);
    await expect
      .poll(async () =>
        Number((await graphCanvas.getAttribute("data-rendered-labels")) ?? 0),
      )
      .toBeGreaterThan(0);

    const sample = await page.evaluate(
      () =>
        new Promise<{ frames: number; elapsedMs: number; fps: number }>(
          (resolve) => {
            let frames = 0;
            const started = performance.now();
            const step = (now: number) => {
              frames += 1;
              const elapsedMs = now - started;
              if (elapsedMs >= 2_000) {
                resolve({
                  frames,
                  elapsedMs,
                  fps: (frames * 1_000) / elapsedMs,
                });
                return;
              }
              requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          },
        ),
    );
    const graphMetrics = metrics.getGraphMetrics();
    console.info(
      `[graph-perf] source=${graphMetrics.sourceCount} returned=${graphMetrics.returnedNodes} throttle=4x viewport=390x844 fps=${sample.fps.toFixed(1)} frames=${sample.frames}`,
    );

    expect(graphMetrics.sourceCount).toBe(5_000);
    expect(graphMetrics.returnedNodes).toBeLessThanOrEqual(180);
    expect(graphMetrics.nextOffset).toBe(180);
    expect(sample.fps).toBeGreaterThanOrEqual(12);
  });

  test("keeps a 2,900-note notebook responsive and heap-stable on mobile", async ({
    context,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("HeapProfiler.enable");
    const configuredCap = Number(process.env.RECALL_NOTEBOOK_EDGE_CAP);
    const notebookEdgeCap =
      Number.isFinite(configuredCap) && configuredCap > 0
        ? configuredCap
        : undefined;
    const metrics = await mockRecall(page, {
      graphSourceCount: 2_900,
      denseNotebook: true,
      notebookEdgeCap,
    });

    await page.goto("/");
    const graphCanvas = page.getByLabel("Interactive knowledge graph");
    await expect(graphCanvas).toBeVisible();
    await page.waitForTimeout(1_800);
    await cdp.send("HeapProfiler.collectGarbage");
    const heapBefore = await cdp.send("Runtime.getHeapUsage");
    const sample = await page.evaluate(
      () =>
        new Promise<{
          frames: number;
          elapsedMs: number;
          fps: number;
          averageFrameMs: number;
          p95FrameMs: number;
        }>((resolve) => {
          const canvas = document.querySelector(
            'canvas[aria-label="Interactive knowledge graph"]',
          );
          const frameTimes: number[] = [];
          let frames = 0;
          let previous = performance.now();
          const started = previous;
          const step = (now: number) => {
            frames += 1;
            frameTimes.push(now - previous);
            previous = now;
            canvas?.dispatchEvent(
              new WheelEvent("wheel", {
                deltaY: frames % 2 === 0 ? 1 : -1,
                cancelable: true,
              }),
            );
            const elapsedMs = now - started;
            if (elapsedMs >= 2_000) {
              const sorted = frameTimes.slice().sort((a, b) => a - b);
              resolve({
                frames,
                elapsedMs,
                fps: (frames * 1_000) / elapsedMs,
                averageFrameMs: elapsedMs / frames,
                p95FrameMs:
                  sorted[Math.floor((sorted.length - 1) * 0.95)] ?? elapsedMs,
              });
              return;
            }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }),
    );
    await cdp.send("HeapProfiler.collectGarbage");
    const heapAfter = await cdp.send("Runtime.getHeapUsage");
    const graphMetrics = metrics.getGraphMetrics();
    const heapGrowthBytes = heapAfter.usedSize - heapBefore.usedSize;
    console.info(
      `[dense-notebook-perf] cap=${notebookEdgeCap ?? "unlimited"} source=${graphMetrics.sourceCount} nodes=${graphMetrics.returnedNodes} edges=${graphMetrics.returnedEdges} fps=${sample.fps.toFixed(1)} avgFrameMs=${sample.averageFrameMs.toFixed(1)} p95FrameMs=${sample.p95FrameMs.toFixed(1)} heapBefore=${heapBefore.usedSize} heapAfter=${heapAfter.usedSize} heapGrowth=${heapGrowthBytes}`,
    );

    expect(graphMetrics.sourceCount).toBe(2_900);
    if (notebookEdgeCap == null) {
      expect(graphMetrics.returnedEdges).toBeGreaterThanOrEqual(141);
    }
    expect(sample.fps).toBeGreaterThanOrEqual(12);
    expect(heapGrowthBytes).toBeLessThan(4 * 1024 * 1024);
  });

  test("falls back to the complete grid for reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockRecall(page, { graphSourceCount: 5_000 });
    await page.goto("/");

    await expect(page.getByTestId("masonry-grid")).toBeVisible();
    await expect(page.getByTestId("knowledge-graph")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Graph", exact: true }),
    ).toBeDisabled();
  });

  test("falls back to the grid on a two-core low-end device", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "hardwareConcurrency", {
        configurable: true,
        get: () => 2,
      });
    });
    await mockRecall(page, { graphSourceCount: 5_000 });
    await page.goto("/");

    await expect(page.getByTestId("masonry-grid")).toBeVisible();
    await expect(page.getByTestId("knowledge-graph")).toHaveCount(0);
  });

  test("keeps capture and grid search panels from intersecting at desktop and mobile", async ({
    page,
  }) => {
    await mockRecall(page);
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.getByRole("button", { name: "Grid", exact: true }).click();
      const capture = await page.getByTestId("capture-box").boundingBox();
      const search = await page.getByTestId("item-search").boundingBox();
      expect(capture).not.toBeNull();
      expect(search).not.toBeNull();
      expect(capture!.y + capture!.height).toBeLessThanOrEqual(search!.y);
    }
  });

  test("keeps the Ask input usable while item detail is open", async ({
    page,
  }) => {
    await mockRecall(page);
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/everything/item-permit");
      await expect(page.getByTestId("item-detail")).toBeVisible();
      const ask = page.getByLabel("Ask Recall");
      await ask.click();
      await ask.fill("");
      await ask.pressSequentially("permit status");
      await expect(ask).toHaveValue("permit status");
    }
  });

  test("Enter performs free keyword search while Ask AI streams exactly once", async ({
    page,
  }) => {
    const mock = await mockRecall(page);
    await page.goto("/");
    const ask = page.getByLabel("Ask Recall");

    await ask.fill("permit");
    await ask.press("Enter");
    await expect(page.getByTestId("keyword-results")).toContainText(
      "Permit revision",
    );
    expect(mock.calls.ai).toBe(0);

    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    await expect(page.getByTestId("ask-output-panel")).toContainText(
      "Permit approved.",
    );
    await expect(page.getByTestId("ask-output-panel")).toContainText(
      "Permit revision",
    );
    expect(mock.calls.ai).toBe(1);
  });

  test("disables Ask AI when the server kill switch is off", async ({
    page,
  }) => {
    await mockRecall(page, { askAiAllowed: false });
    await page.goto("/");
    await page.getByLabel("Ask Recall").fill("permit");
    const askAi = page.getByRole("button", { name: "Ask AI", exact: true });
    await expect(askAi).toBeDisabled();
    await expect(askAi).toHaveAttribute("title", "Ask AI is disabled");
  });

  test("reloads once per activated build and never reloads while typing", async ({
    page,
  }) => {
    await mockRecall(page);
    let nextBuild = "e2e-new-build-1";
    let documentRequests = 0;
    page.on("request", (request) => {
      if (request.resourceType() === "document") documentRequests += 1;
    });
    await page.route("**/build.json", (route) =>
      json(route, { buildId: nextBuild }),
    );

    await page.goto("/");
    expect(documentRequests).toBe(1);
    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    });
    await expect.poll(() => documentRequests).toBe(2);

    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    });
    await page.waitForTimeout(400);
    expect(documentRequests).toBe(2);

    nextBuild = "e2e-new-build-2";
    const input = page.getByLabel("Ask Recall");
    await input.fill("unsent question");
    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    });
    await page.waitForTimeout(400);
    expect(documentRequests).toBe(2);
    await expect(input).toHaveValue("unsent question");
    await expect(page.locator("[data-recall-update-toast]")).toContainText(
      "New version ready",
    );
  });
});
