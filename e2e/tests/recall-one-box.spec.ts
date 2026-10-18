import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const localFeatureTarget =
  /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(
    process.env.E2E_BASE_URL?.replace(/\/$/, "") ?? "",
  );
const now = "2026-10-18T12:00:00.000Z";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function savedItem(overrides: Record<string, unknown> = {}) {
  return {
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
    tags: [],
    notebook: "House Projects",
    trashed: false,
    bumpedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function mockRecall(page: Page) {
  const items = [savedItem()];
  const calls = {
    saves: [] as string[],
    files: 0,
    deletes: [] as string[],
    searches: [] as string[],
    ai: 0,
    voice: 0,
    ttsTexts: [] as string[],
    graphQueries: [] as Array<{ q: string; offset: string; limit: string }>,
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
    if (["/api/notes", "/api/tasks", "/api/notebooks"].includes(url.pathname)) {
      const key = url.pathname.slice(5);
      return json(route, { [key]: [] });
    }
    if (url.pathname === "/api/home") return json(route, { review: {} });
    if (url.pathname === "/api/finance/refresh") {
      return json(route, { ok: true, synced: false, skipped: true });
    }
    if (url.pathname === "/api/ai/query/availability") {
      return json(route, { allowed: true, model: "gpt-4.1-mini" });
    }
    if (url.pathname === "/api/items/graph") {
      if (url.searchParams.get("q") === "graph fails") {
        return json(route, { message: "Graph unavailable" }, 503);
      }
      calls.graphQueries.push({
        q: url.searchParams.get("q") ?? "",
        offset: url.searchParams.get("offset") ?? "0",
        limit: url.searchParams.get("limit") ?? "350",
      });
      const graphLimit = Number(url.searchParams.get("limit") ?? 350);
      const graphOffset = Number(url.searchParams.get("offset") ?? 0);
      return json(route, {
        nodes: url.searchParams.get("q")
          ? [
              {
                id: "item-node:gmail-roofer",
                itemId: "source-record:gmail-roofer",
                type: "gmail",
                label: "Roof contract",
                value: 4,
                hub: false,
                href: "/everything/source-record%3Agmail-roofer",
              },
            ]
          : [],
        edges: [],
        page: {
          offset: graphOffset,
          limit: graphLimit,
          nextOffset: url.searchParams.get("q")
            ? graphOffset + graphLimit
            : null,
        },
      });
    }
    if (url.pathname === "/api/items" && request.method() === "GET") {
      return json(route, { items });
    }
    if (url.pathname === "/api/items" && request.method() === "POST") {
      const value = (request.postDataJSON() as { value: string }).value;
      calls.saves.push(value);
      const item = savedItem({
        id: `item-created-${calls.saves.length}`,
        title: value,
        bodyText: value,
      });
      items.unshift(item);
      return json(route, { item, existing: false }, 201);
    }
    if (url.pathname === "/api/items/file" && request.method() === "POST") {
      calls.files += 1;
      const item = savedItem({
        id: `item-file-${calls.files}`,
        kind: "image",
        title: "receipt",
        media: {
          storagePath: "owner/items/item-file/receipt.png",
          fileName: "receipt.png",
          mimeType: "image/png",
        },
      });
      items.unshift(item);
      return json(route, { item, existing: false }, 201);
    }
    if (
      url.pathname.startsWith("/api/items/") &&
      request.method() === "DELETE"
    ) {
      const id = decodeURIComponent(url.pathname.slice("/api/items/".length));
      calls.deletes.push(id);
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) items.splice(index, 1);
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === "/api/items/search") {
      const query = url.searchParams.get("q") ?? "";
      calls.searches.push(query);
      return json(route, {
        results: [
          {
            id: "source_record:evernote-warranty",
            entityType: "source_record",
            source: "Evernote",
            kind: "evernote_note",
            title: "Roof warranty",
            snippet: "Warranty expires October 18, 2031.",
            notebook: "House",
            date: now,
            openUrl: "https://www.evernote.com/example",
            itemId: "evernote:evernote-warranty",
            document: null,
          },
          {
            id: "source_record:gmail-roofer",
            entityType: "source_record",
            source: "Gmail",
            kind: "gmail_message",
            title: "Roof contract",
            snippet: "Attached signed contract.",
            notebook: null,
            date: now,
            openUrl: "https://mail.google.com/example",
            itemId: null,
            document: {
              kind: "gmail",
              name: "roof-contract.pdf",
              mimeType: "application/pdf",
              previewUrl: "/api/items/source-records/drive-roof/media",
              downloadUrl:
                "/api/items/source-records/drive-roof/media?download=1",
            },
          },
          {
            id: "source_record:drive-roof",
            entityType: "source_record",
            source: "Drive",
            kind: "drive_file",
            title: "Roof inspection",
            snippet: "Final inspection report.",
            notebook: null,
            date: now,
            openUrl: "https://drive.google.com/example",
            itemId: null,
            document: {
              kind: "drive",
              name: "roof-inspection.pdf",
              mimeType: "application/pdf",
              previewUrl: "/api/items/source-records/drive-roof/media",
              downloadUrl:
                "/api/items/source-records/drive-roof/media?download=1",
            },
          },
        ],
      });
    }
    if (url.pathname === "/api/ai/voice/query") {
      calls.voice += 1;
      return json(route, {
        answer: "The contract expires October 18, 2031.",
        confidence: 0.9,
        caveats: null,
        evidence: [],
        relatedRecords: [],
        images: [],
        suggestedNextAction: null,
        threadId: "voice-thread",
        sources: [
          {
            itemId: "evernote:evernote-warranty",
            title: "Roof warranty",
            notebook: "House",
            date: now,
            source: "Evernote",
            recordType: "evernote_note",
            isDocument: false,
          },
          {
            itemId: "source_record:gmail-roofer",
            title: "Roof contract",
            notebook: null,
            date: now,
            source: "Gmail",
            recordType: "gmail_message",
            isDocument: true,
          },
        ],
      });
    }
    if (url.pathname === "/api/ai/tts") {
      calls.ttsTexts.push(
        (request.postDataJSON() as { text?: string }).text ?? "",
      );
      return json(route, { reason: "disabled", message: "TTS disabled" }, 503);
    }
    if (url.pathname === "/api/ai/query/stream") {
      calls.ai += 1;
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          'event: token\ndata: {"delta":"Roof warranty answer."}\n\n',
          'event: done\ndata: {"answer":"Roof warranty answer.","confidence":0.9,"caveats":null,"evidence":[],"relatedRecords":[],"images":[],"suggestedNextAction":null,"threadId":"thread-1"}\n\n',
        ].join(""),
      });
    }
    if (url.pathname.startsWith("/api/items/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/items/".length));
      const item =
        id === "source-record:gmail-roofer"
          ? savedItem({
              id,
              source: "gmail",
              kind: "gmail_message",
              title: "Roof contract",
              bodyText: "Attached signed contract.",
            })
          : items.find((candidate) => candidate.id === id);
      return item
        ? json(route, { item })
        : json(route, { message: "Not found" }, 404);
    }
    return json(route, {});
  });
  return calls;
}

async function installVoice(page: Page, transcript = "find roof contract") {
  await page.addInitScript((text) => {
    Object.assign(window, { __recallTranscript: text });
    const track = { stop() {} };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [track] }),
      },
    });
    class Recognition {
      static async available() {
        return "available";
      }
      continuous = false;
      interimResults = false;
      lang = "";
      processLocally = false;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      start() {}
      stop() {
        const current =
          (window as unknown as { __recallTranscript?: string })
            .__recallTranscript ?? text;
        const result = Object.assign([{ transcript: current }], {
          isFinal: true,
        });
        this.onresult?.({ results: [result] });
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    class Utterance {
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    Object.assign(window, {
      SpeechRecognition: Recognition,
      webkitSpeechRecognition: Recognition,
      SpeechSynthesisUtterance: Utterance,
    });
    window.speechSynthesis.getVoices = () => [];
    window.speechSynthesis.speak = (utterance) => {
      window.setTimeout(
        () => utterance.onend?.(new Event("end") as SpeechSynthesisEvent),
        0,
      );
    };
    window.speechSynthesis.cancel = () => {};
  }, transcript);
}

test.describe("Recall one-box Phase 1", () => {
  test.skip(
    !localFeatureTarget,
    "One-box tests require the checked-out frontend",
  );

  test("remember saves and Undo deletes only the created item", async ({
    page,
  }) => {
    const calls = await mockRecall(page);
    await page.goto("/");
    const input = page.getByLabel("Tell or ask Recall");
    await input.fill("remember the gate code is 4471");
    await input.press("Enter");
    await expect(page.getByTestId("one-box-action-chip")).toContainText(
      "Saved",
    );
    expect(calls.saves).toEqual(["the gate code is 4471"]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(calls.deletes).toEqual(["item-created-1"]);
  });

  test("a dropped image and a bare link save through the same box", async ({
    page,
  }) => {
    const calls = await mockRecall(page);
    await page.goto("/");
    const dataTransfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["image"], "receipt.png", { type: "image/png" }),
      );
      return transfer;
    });
    await page.getByTestId("recall-explore").dispatchEvent("drop", {
      dataTransfer,
    });
    await expect(page.getByText("receipt.png", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Send to Recall" }).click();
    expect(calls.files).toBe(1);

    const input = page.getByLabel("Tell or ask Recall");
    await input.fill("https://example.com/roof");
    await input.press("Enter");
    expect(calls.saves).toContain("https://example.com/roof");
  });

  test("question search spans sources with labels and does not invoke AI", async ({
    page,
  }) => {
    const calls = await mockRecall(page);
    await page.goto("/");
    const input = page.getByLabel("Tell or ask Recall");
    await input.fill("when does my roof warranty expire?");
    await input.press("Enter");
    await expect(page.getByTestId("keyword-results")).toContainText("Evernote");
    await expect(page.getByTestId("keyword-results")).toContainText("Gmail");
    await expect(page.getByTestId("keyword-results")).toContainText("Drive");
    expect(calls.searches).toEqual(["when does my roof warranty expire?"]);
    expect(calls.ai).toBe(0);
  });

  test("a free search seeds the graph and graph pages preserve the query", async ({
    page,
  }) => {
    const calls = await mockRecall(page);
    await page.goto("/");
    await page.getByLabel("Tell or ask Recall").fill("roof contract");
    await page.getByLabel("Tell or ask Recall").press("Enter");
    await expect
      .poll(() =>
        calls.graphQueries.some((entry) => entry.q === "roof contract"),
      )
      .toBe(true);
    await page.getByRole("button", { name: "Older", exact: true }).click();
    await expect
      .poll(() =>
        calls.graphQueries.some(
          (entry) => entry.q === "roof contract" && entry.offset === "350",
        ),
      )
      .toBe(true);
    const canvas = page.getByLabel(/Interactive knowledge graph/);
    await canvas.focus();
    await canvas.press("Enter");
    await expect(page.locator(".hud-detail")).toContainText("Roof contract");
    await expect(page.locator(".hud-detail")).toContainText("Gmail");
    expect(calls.ai).toBe(0);
  });

  test("mobile graph paging uses the visible 180-row page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const calls = await mockRecall(page);
    await page.goto("/");
    await page.getByLabel("Tell or ask Recall").fill("roof contract");
    await page.getByLabel("Tell or ask Recall").press("Enter");
    await expect
      .poll(() =>
        calls.graphQueries.some(
          (entry) =>
            entry.q === "roof contract" &&
            entry.offset === "0" &&
            entry.limit === "180",
        ),
      )
      .toBe(true);
    await page.getByRole("button", { name: "Older", exact: true }).click();
    await expect
      .poll(() =>
        calls.graphQueries.some(
          (entry) =>
            entry.q === "roof contract" &&
            entry.offset === "180" &&
            entry.limit === "180",
        ),
      )
      .toBe(true);
  });

  test("keyword results survive an auxiliary graph failure", async ({
    page,
  }) => {
    const calls = await mockRecall(page);
    await page.goto("/");
    await page.getByLabel("Tell or ask Recall").fill("graph fails");
    await page.getByLabel("Tell or ask Recall").press("Enter");
    await expect(page.getByTestId("keyword-results")).toContainText("Evernote");
    expect(calls.searches).toEqual(["graph fails"]);
    expect(calls.ai).toBe(0);
  });

  test("a typed ask keeps the normal on-screen answer", async ({ page }) => {
    const calls = await mockRecall(page);
    await page.goto("/");
    const input = page.getByLabel("Tell or ask Recall");
    await input.fill("when does my roof warranty expire?");
    await input.press("Enter");
    await page.getByRole("button", { name: "Ask AI" }).click();
    await expect(page.getByTestId("ai-answer")).toContainText(
      "Roof warranty answer.",
    );
    expect(calls.ai).toBe(1);
  });

  test("has one box, one mic, and no source tabs or filter chips at both sizes", async ({
    page,
  }) => {
    await mockRecall(page);
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.getByTestId("one-box")).toHaveCount(1);
      await expect(page.getByTestId("recall-ring-mic")).toHaveCount(1);
      await expect(page.getByTestId("search-filters")).toHaveCount(0);
      await expect(page.getByLabel("Graph filters")).toHaveCount(0);
      await expect(page.locator("[role=tab]")).toHaveCount(0);
      await expect(page.locator(".hud-chip")).toHaveCount(0);
      for (const testId of ["one-box", "recall-ring-mic"]) {
        const bounds = await page.getByTestId(testId).boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      }
    }
  });

  test("voice renders no proof until spoken show-me reveals the cached answer and document", async ({
    page,
  }) => {
    await installVoice(page);
    const calls = await mockRecall(page);
    await page.goto("/");
    const mic = page.getByTestId("recall-ring-mic");
    await mic.click();
    await mic.click();
    await expect(page.getByTestId("voice-spoken-only")).toBeVisible();
    await expect(page.getByTestId("document-card")).toHaveCount(0);
    await expect(page.getByTestId("one-box-result")).toHaveCount(0);
    await expect(
      page.getByText("The contract expires October 18, 2031.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect.poll(() => calls.ttsTexts.length).toBe(1);
    expect(calls.ttsTexts[0]).toContain(
      'I found the document; say "show me" to open it.',
    );
    await expect(mic).toHaveClass(/is-ready/);

    const searchesBefore = calls.searches.length;
    const voiceBefore = calls.voice;
    await page.evaluate(() => {
      (window as unknown as { __recallTranscript: string }).__recallTranscript =
        "show me";
    });
    await mic.click();
    await mic.click();
    await expect(page.getByTestId("show-me-state")).toContainText(
      "roof-contract.pdf",
    );
    await expect(page.getByTestId("show-me-state")).toContainText("Evernote");
    expect(calls.searches).toHaveLength(searchesBefore);
    expect(calls.voice).toBe(voiceBefore);
  });

  test("show me with no prior voice answer is handled without a search or AI call", async ({
    page,
  }) => {
    await installVoice(page, "show me");
    const calls = await mockRecall(page);
    await page.goto("/");
    const mic = page.getByTestId("recall-ring-mic");
    await mic.click();
    await mic.click();
    await expect(
      page.getByText("Nothing to show yet", { exact: true }),
    ).toBeVisible();
    expect(calls.searches).toHaveLength(0);
    expect(calls.voice).toBe(0);
    expect(calls.ai).toBe(0);
  });

  test("captures desktop and 390x844 one-box, document and show states", async ({
    page,
  }) => {
    const dir = process.env.ONE_BOX_SCREENSHOT_DIR;
    test.skip(!dir, "Screenshot artifact run only");
    await mkdir(dir!, { recursive: true });
    await installVoice(page);
    await mockRecall(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.screenshot({ path: `${dir}/recall-one-box-desktop.png` });
    const mic = page.getByTestId("recall-ring-mic");
    await mic.click();
    await mic.click();
    await expect(page.getByTestId("voice-spoken-only")).toBeVisible();
    await page.getByTestId("show-voice-results").click();
    await expect(page.getByTestId("document-card")).toBeVisible();
    await page.screenshot({ path: `${dir}/recall-document-card-desktop.png` });
    await page.screenshot({ path: `${dir}/recall-show-me-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.screenshot({ path: `${dir}/recall-one-box-mobile-390x844.png` });
    const mobileMic = page.getByTestId("recall-ring-mic");
    await mobileMic.click();
    await mobileMic.click();
    await expect(page.getByTestId("voice-spoken-only")).toBeVisible();
    await page.getByTestId("show-voice-results").click();
    await expect(page.getByTestId("document-card")).toBeVisible();
    await page.screenshot({
      path: `${dir}/recall-document-card-mobile-390x844.png`,
    });
    await page.screenshot({
      path: `${dir}/recall-show-me-mobile-390x844.png`,
    });
  });

  test("a service-worker update reloads once and never loops", async ({
    page,
  }) => {
    await mockRecall(page);
    let documentRequests = 0;
    page.on("request", (request) => {
      if (request.resourceType() === "document") documentRequests += 1;
    });
    await page.route("**/build.json", (route) =>
      json(route, { buildId: "one-box-build" }),
    );
    await page.goto("/");
    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    });
    await expect.poll(() => documentRequests).toBe(2);
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    });
    await page.waitForTimeout(350);
    expect(documentRequests).toBe(2);
  });
});
