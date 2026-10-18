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
    voiceAiReason?: "disabled" | "daily_limit" | "unavailable" | null;
    voiceNoMatch?: boolean;
    denseNotebook?: boolean;
    notebookEdgeCap?: number;
  } = {},
) {
  const items = [...baseItems];
  const calls = {
    ai: 0,
    voiceAsk: 0,
    voiceBodies: [] as Array<{ question: string; threadId?: string }>,
    itemSearch: 0,
    itemQueries: [] as string[],
    transcribe: 0,
    tts: 0,
  };
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
    if (url.pathname === "/api/ai/voice/availability") {
      return json(route, {
        allowed: options.voiceAiReason == null,
        remaining: options.voiceAiReason == null ? 29 : undefined,
        reason: options.voiceAiReason ?? undefined,
      });
    }
    if (url.pathname === "/api/ai/voice/query") {
      calls.voiceAsk += 1;
      calls.voiceBodies.push(request.postDataJSON());
      const noMatch = options.voiceNoMatch === true;
      return json(route, {
        answer: noMatch
          ? "I couldn't find that in your notes."
          : "The permit revision was approved. From your note Permit revision, October 2026.",
        confidence: noMatch ? 0.2 : 0.9,
        caveats: noMatch ? "Limited matching records found." : null,
        evidence: [],
        relatedRecords: noMatch
          ? []
          : [
              {
                entityType: "item",
                entityId: "item-permit",
                title: "Permit revision",
              },
            ],
        images: [],
        suggestedNextAction: null,
        threadId: "voice-thread-1",
        sources: noMatch
          ? []
          : [
              {
                itemId: "item-permit",
                title: "Permit revision",
                notebook: "House Projects",
                date: now,
              },
            ],
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
    if (url.pathname === "/api/ai/transcribe") {
      calls.transcribe += 1;
      return json(route, { message: "Server transcription disabled" }, 503);
    }
    if (url.pathname === "/api/ai/tts") {
      calls.tts += 1;
      return json(route, { message: "Server TTS disabled" }, 503);
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
      if (q) calls.itemQueries.push(q);
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

async function installVoiceHarness(
  page: Page,
  mode: "permission-denied" | "manual-result",
) {
  await page.addInitScript((voiceMode) => {
    const state = {
      stopCalls: 0,
      abortCalls: 0,
      trackStops: 0,
      speakCalls: 0,
      cancelCalls: 0,
      processLocally: false,
    };
    Object.assign(window, { __recallVoiceTest: state });

    const track = { stop: () => (state.trackStops += 1) };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [track],
        }),
      },
    });

    class FakeSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      private locally = false;
      set processLocally(value: boolean) {
        this.locally = value;
        state.processLocally = value;
      }
      get processLocally() {
        return this.locally;
      }
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onnomatch: (() => void) | null = null;

      start() {
        if (voiceMode === "permission-denied") {
          setTimeout(() => this.onerror?.({ error: "not-allowed" }), 20);
        }
      }

      stop() {
        state.stopCalls += 1;
        if (voiceMode === "manual-result") {
          const result = Object.assign([{ transcript: "permit" }], {
            isFinal: true,
          });
          this.onresult?.({ results: [result] });
          this.onend?.();
        }
      }

      abort() {
        state.abortCalls += 1;
        this.onend?.();
      }
    }

    class FakeSpeechSynthesisUtterance {
      rate = 1;
      pitch = 1;
      voice: SpeechSynthesisVoice | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }

    Object.assign(window, {
      SpeechRecognition: FakeSpeechRecognition,
      webkitSpeechRecognition: FakeSpeechRecognition,
      SpeechSynthesisUtterance: FakeSpeechSynthesisUtterance,
    });

    const synthesis = window.speechSynthesis;
    synthesis.getVoices = () =>
      [
        {
          default: true,
          lang: "en-US",
          localService: true,
          name: "Test Natural",
          voiceURI: "test-natural",
        },
      ] as SpeechSynthesisVoice[];
    synthesis.speak = () => {
      state.speakCalls += 1;
    };
    synthesis.cancel = () => {
      state.cancelCalls += 1;
    };
  }, mode);
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
    await expect(page.getByTestId("assistant-ring-mobile")).toBeVisible();
    await expect(
      page.getByLabel(/R\.E\.C\.A\.L\.L\. ready/i).last(),
    ).toBeVisible();
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
    await page.getByRole("button", { name: "Fit graph to view" }).click();
    await expect
      .poll(async () =>
        Number((await graphCanvas.getAttribute("data-graph-stretch-x")) ?? 0),
      )
      .toBeCloseTo(0.64, 2);
    const fitTop = Number(await graphCanvas.getAttribute("data-graph-fit-top"));
    const fitBottom = Number(
      await graphCanvas.getAttribute("data-graph-fit-bottom"),
    );
    expect(fitTop).toBeGreaterThanOrEqual(18);
    expect(fitBottom).toBeGreaterThan(fitTop + 300);
    expect(
      Number(await graphCanvas.getAttribute("data-rendered-labels")),
    ).toBeLessThanOrEqual(20);

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
    const screenshotDir = process.env.GRAPH_SCREENSHOT_DIR;
    const screenshotPrefix =
      process.env.GRAPH_SCREENSHOT_PREFIX ?? "graph_fit_polish_after";
    if (screenshotDir) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/");
      await page.getByRole("button", { name: "Fit graph to view" }).click();
      await page.waitForTimeout(1_200);
      await page.screenshot({
        path: `${screenshotDir}/${screenshotPrefix}_desktop.png`,
        fullPage: true,
      });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("HeapProfiler.enable");
    await page.goto("/");
    const graphCanvas = page.getByLabel("Interactive knowledge graph");
    await expect(graphCanvas).toBeVisible();
    await page.waitForTimeout(1_800);
    await page.getByRole("button", { name: "Fit graph to view" }).click();
    await page.waitForTimeout(1_200);
    if (screenshotDir) {
      await page.screenshot({
        path: `${screenshotDir}/${screenshotPrefix}_mobile_390x844.png`,
        fullPage: true,
      });
    }
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

  test("voice answers default off and a finished AI answer never calls paid or browser TTS", async ({
    page,
  }) => {
    await installVoiceHarness(page, "manual-result");
    const mock = await mockRecall(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("recall.voiceAnswers"));
    await page.reload();

    await page.getByLabel("Ask Recall").fill("permit");
    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    await expect(page.getByTestId("ask-output-panel")).toContainText(
      "Permit approved.",
    );

    const speakCalls = await page.evaluate(
      () =>
        (
          window as unknown as Window & {
            __recallVoiceTest: { speakCalls: number };
          }
        ).__recallVoiceTest.speakCalls,
    );
    expect(speakCalls).toBe(0);
    expect(mock.calls.tts).toBe(0);
  });

  test("permission denial shows an error, stops permission tracks, and restores READY", async ({
    page,
  }) => {
    await installVoiceHarness(page, "permission-denied");
    await mockRecall(page);
    await page.goto("/");

    await page.getByTestId("ask-bar-mic").click();
    await expect(
      page.getByText("Microphone blocked", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("assistant-ring-desktop")).toHaveClass(
      /is-ready/,
    );
    const trackStops = await page.evaluate(
      () =>
        (
          window as unknown as Window & {
            __recallVoiceTest: { trackStops: number };
          }
        ).__recallVoiceTest.trackStops,
    );
    expect(trackStops).toBe(1);
  });

  test("search-bar mic stays free, on-device where available, and never uploads audio", async ({
    page,
  }) => {
    await installVoiceHarness(page, "manual-result");
    const mock = await mockRecall(page);
    await page.goto("/");

    await page.getByTestId("ask-bar-mic").click();
    await expect(page.getByTestId("assistant-ring-desktop")).toHaveClass(
      /is-ready/,
    );
    await expect(page.getByTestId("ask-bar-mic")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByTestId("ask-bar-mic").click();

    await expect(page.getByLabel("Ask Recall")).toHaveValue("permit");
    await expect(page.getByTestId("keyword-results")).toContainText(
      "Permit revision",
    );
    await expect(page.getByTestId("assistant-ring-desktop")).toHaveClass(
      /is-ready/,
    );
    const state = await page.evaluate(
      () =>
        (
          window as unknown as Window & {
            __recallVoiceTest: {
              stopCalls: number;
              abortCalls: number;
              processLocally: boolean;
            };
          }
        ).__recallVoiceTest,
    );
    expect(state.stopCalls).toBe(1);
    expect(state.abortCalls).toBe(0);
    expect(state.processLocally).toBe(true);
    expect(
      mock.calls.itemQueries.filter((query) => query === "permit"),
    ).toHaveLength(1);
    expect(mock.calls.ai).toBe(0);
    expect(mock.calls.voiceAsk).toBe(0);
    expect(mock.calls.transcribe).toBe(0);
    expect(mock.calls.tts).toBe(0);
  });

  test("Talk asks once, speaks with browser fallback, shows sources, and reuses its thread", async ({
    page,
  }) => {
    await installVoiceHarness(page, "manual-result");
    const mock = await mockRecall(page);
    await page.goto("/");

    await page.getByTestId("ring-mic-desktop").click();
    await expect(page.getByTestId("assistant-ring-desktop")).toHaveClass(
      /is-listening/,
    );
    await page.getByTestId("ring-mic-desktop").click();

    await expect(page.getByTestId("talk-transcript")).toContainText("You");
    await expect(page.getByTestId("talk-transcript")).toContainText(
      "The permit revision was approved.",
    );
    await expect(page.getByTestId("talk-source-chip")).toContainText(
      "Permit revision · House Projects · Oct 2026",
    );
    await expect.poll(() => mock.calls.tts).toBe(1);
    expect(mock.calls.voiceAsk).toBe(1);
    expect(mock.calls.transcribe).toBe(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as Window & {
                __recallVoiceTest: { speakCalls: number };
              }
            ).__recallVoiceTest.speakCalls,
        ),
      )
      .toBe(2);

    // A tap while speaking stops output rather than starting another capture.
    await page.getByTestId("ring-mic-desktop").click();
    await expect(page.getByTestId("assistant-ring-desktop")).not.toHaveClass(
      /is-speaking/,
    );

    await page.getByTestId("ring-mic-desktop").click();
    await page.getByTestId("ring-mic-desktop").click();
    await expect.poll(() => mock.calls.voiceAsk).toBe(2);
    expect(mock.calls.voiceBodies[1]?.threadId).toBe("voice-thread-1");
  });

  test("Talk falls back to free keyword search and browser speech when the master switch is off", async ({
    page,
  }) => {
    await installVoiceHarness(page, "manual-result");
    const mock = await mockRecall(page, { voiceAiReason: "disabled" });
    await page.goto("/");

    await page.getByTestId("ring-mic-desktop").click();
    await page.getByTestId("ring-mic-desktop").click();
    await expect(page.getByTestId("talk-transcript")).toContainText(
      "The top match is Permit revision.",
    );
    expect(mock.calls.voiceAsk).toBe(0);
    expect(mock.calls.tts).toBe(0);
    expect(mock.calls.transcribe).toBe(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as Window & {
                __recallVoiceTest: { speakCalls: number };
              }
            ).__recallVoiceTest.speakCalls,
        ),
      )
      .toBe(2);
  });

  test("Talk speaks the cap notice and the exact no-match reply", async ({
    page,
  }) => {
    await installVoiceHarness(page, "manual-result");
    const capped = await mockRecall(page, { voiceAiReason: "daily_limit" });
    await page.goto("/");
    await page.getByTestId("ring-mic-desktop").click();
    await page.getByTestId("ring-mic-desktop").click();
    await expect(page.getByTestId("talk-transcript")).toContainText(
      "Daily voice limit reached. Free search still works.",
    );
    expect(capped.calls.voiceAsk).toBe(0);

    await page.unrouteAll({ behavior: "wait" });
    const noMatch = await mockRecall(page, { voiceNoMatch: true });
    await page.getByTestId("ring-mic-desktop").click();
    await page.getByTestId("ring-mic-desktop").click();
    await page.getByTestId("ring-mic-desktop").click();
    await expect(page.getByTestId("talk-transcript")).toContainText(
      "I couldn't find that in your notes.",
    );
    expect(noMatch.calls.voiceAsk).toBe(1);
  });

  test("iOS standalone shows the dictation guidance and never uploads audio", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
      });
      Object.defineProperty(navigator, "standalone", {
        configurable: true,
        value: true,
      });
      class FakeSpeechRecognition {}
      Object.assign(window, {
        SpeechRecognition: FakeSpeechRecognition,
        webkitSpeechRecognition: FakeSpeechRecognition,
      });
    });
    const mock = await mockRecall(page);
    await page.goto("/");

    await page.getByTestId("ask-bar-mic").click();
    await expect(
      page.getByText(
        "Voice works in Safari/Chrome tab, or use your keyboard's dictation mic",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByTestId("assistant-ring-desktop")).toHaveClass(
      /is-ready/,
    );
    expect(mock.calls.transcribe).toBe(0);
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
