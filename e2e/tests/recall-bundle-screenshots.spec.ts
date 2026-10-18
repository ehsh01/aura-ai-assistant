import { mkdir } from "node:fs/promises";
import { expect, test, type Page, type Route } from "@playwright/test";

const captureDir = process.env.RECALL_SCREENSHOT_DIR;
const captureState = process.env.RECALL_SCREENSHOT_STATE;

test.skip(
  !captureDir || !captureState,
  "Manual walkthrough screenshot harness",
);

const now = "2026-10-17T12:00:00.000Z";

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function note(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `note-${index}`,
    title: `Maintenance record ${index}`,
    preview: `Reference details for household project ${index}.`,
    tags: index % 2 ? ["Personal"] : ["Work"],
    date: "Oct 17",
    pinned: index < 3,
    notebookId: index % 2 ? "notebook-home" : "notebook-work",
    projectId: null,
    primaryPersonId: null,
    primaryPersonName: null,
    contentFormat: "plain",
    attachmentCount: 0,
    createdAt: now,
    updatedAt: new Date(Date.parse(now) - index * 60_000).toISOString(),
    ...overrides,
  };
}

async function mockRecall(page: Page) {
  const notes = Array.from({ length: 100 }, (_, index) => note(index + 1));
  const oilChangeNote = note(145, {
    title: "Subaru service log",
    preview: "Vehicle maintenance notes from last winter.",
    tags: ["Personal", "Vehicles"],
  });
  const items = Array.from({ length: 18 }, (_, index) => ({
    id: `item-${index + 1}`,
    kind: index % 3 === 0 ? "link" : "note",
    state: "ready",
    source: index % 4 === 0 ? "evernote" : "recall",
    title: [
      "Kitchen renovation permits",
      "Quarterly planning notes",
      "Subaru maintenance schedule",
      "Garden irrigation ideas",
    ][index % 4],
    description: `Saved reference ${index + 1} with useful context and follow-up details.`,
    domain: null,
    sourceUrl: null,
    bodyText: `Long-form saved item content for reference ${index + 1}.`,
    media: {},
    tags: [`topic-${index % 6}`, index % 2 ? "personal" : "work"],
    notebook: index % 2 ? "Home" : "Work",
    trashed: false,
    bumpedAt: now,
    createdAt: now,
    updatedAt: now,
  }));

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
    if (url.pathname === "/api/notes") {
      return json(
        route,
        url.searchParams.get("q")?.toLowerCase() === "oil change"
          ? { notes: [oilChangeNote], nextCursor: null, hasMore: false }
          : { notes, nextCursor: "page-2", hasMore: true },
      );
    }
    if (url.pathname.startsWith("/api/notes/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/notes/".length));
      const metadata =
        id === oilChangeNote.id
          ? oilChangeNote
          : notes.find((entry) => entry.id === id);
      return json(route, {
        ...metadata,
        content:
          id === oilChangeNote.id
            ? "Completed an oil change with 0W-20 synthetic oil and replaced the filter."
            : "Detailed note body.",
        summary: null,
        factBullets: [],
      });
    }
    if (url.pathname === "/api/tasks") return json(route, { tasks: [] });
    if (url.pathname === "/api/people") return json(route, { people: [] });
    if (url.pathname === "/api/organizations") {
      return json(route, { organizations: [] });
    }
    if (url.pathname === "/api/notebooks") {
      return json(route, {
        notebooks: [
          {
            id: "notebook-home",
            name: "Home",
            source: "recall",
            noteCount: 55,
            date: "Oct 17",
          },
          {
            id: "notebook-work",
            name: "Work",
            source: "recall",
            noteCount: 46,
            date: "Oct 17",
          },
        ],
      });
    }
    if (url.pathname === "/api/home") return json(route, { review: {} });
    if (url.pathname === "/api/ai/query/availability") {
      return json(route, {
        allowed: true,
        model: "gpt-4.1-mini",
        reason: null,
      });
    }
    if (url.pathname === "/api/ai/query/stream") {
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          'event: meta\ndata: {"threadId":"thread-1","evidence":[{"id":"evidence-1","entityType":"item","entityId":"item-1","claimType":"source","sourceCaptureId":null,"sourceRecordId":null,"evidenceText":"City approval and next steps","evidenceMetadata":{},"fileName":null,"url":"https://example.com/permit","createdAt":"2026-10-17T12:00:00.000Z"}],"relatedRecords":[{"entityType":"item","entityId":"item-1","title":"Kitchen renovation permits"}]}\n\n',
          'event: token\ndata: {"delta":"**Permit approved.** "}\n\n',
          'event: token\ndata: {"delta":"The revision is ready for the next inspection."}\n\n',
          'event: done\ndata: {"answer":"**Permit approved.** The revision is ready for the next inspection.","confidence":0.92,"caveats":null,"evidence":[{"id":"evidence-1","entityType":"item","entityId":"item-1","claimType":"source","sourceCaptureId":null,"sourceRecordId":null,"evidenceText":"City approval and next steps","evidenceMetadata":{},"fileName":null,"url":"https://example.com/permit","createdAt":"2026-10-17T12:00:00.000Z"}],"relatedRecords":[{"entityType":"item","entityId":"item-1","title":"Kitchen renovation permits"}],"images":[],"suggestedNextAction":null,"threadId":"thread-1"}\n\n',
        ].join(""),
      });
    }
    if (url.pathname === "/api/finance/refresh") {
      return json(route, { ok: true, synced: false, skipped: true });
    }
    if (url.pathname === "/api/items/facets") {
      return json(route, {
        tags: ["personal", "work", "vehicles"],
        notebooks: ["Home", "Work"],
      });
    }
    if (url.pathname === "/api/items/graph") {
      const requestedLimit = Math.min(
        Number(url.searchParams.get("limit") ?? 350),
        500,
      );
      const itemCount = Math.floor(requestedLimit * 0.8);
      const itemNodes = Array.from({ length: itemCount }, (_, index) => ({
        id: `item-node-${index}`,
        itemId: items[index % items.length]!.id,
        type: index % 5 === 0 ? ("evernote" as const) : ("notes" as const),
        label: `Imported note ${index + 1}`,
        value: 4 + (index % 3),
        hub: false,
        href: `/everything/${items[index % items.length]!.id}`,
      }));
      const notebookHub = {
        id: "notebooks:everything",
        itemId: null,
        type: "notebooks" as const,
        label: "Everything",
        value: 18,
        hub: true,
        href: "/everything?notebook=Everything",
      };
      const tagHubs = Array.from({ length: 10 }, (_, index) => ({
        id: `tags:one-off-${index}`,
        itemId: null,
        type: "tags" as const,
        label: `Topic ${index + 1}`,
        value: 8,
        hub: true,
        href: "/everything",
      }));
      const notebookEdgeCount =
        captureState === "before" ? 8 : Math.max(0, itemCount - 3);
      const notebookEdges = itemNodes
        .slice(0, notebookEdgeCount)
        .map((node, index) => ({
          id: `notebook-edge-${index}`,
          source: node.id,
          target: notebookHub.id,
          signal: "notebook" as const,
        }));
      const tagEdges = itemNodes
        .filter((_, index) => index % 29 === 0)
        .map((node, index) => ({
          id: `tag-edge-${index}`,
          source: node.id,
          target: tagHubs[index % tagHubs.length]!.id,
          signal: "tag" as const,
        }));
      return json(route, {
        nodes: [...itemNodes, notebookHub, ...tagHubs],
        edges: [...notebookEdges, ...tagEdges],
        page: {
          offset: 0,
          limit: requestedLimit,
          nextOffset: requestedLimit,
          sourceCount: 2_900,
        },
      });
    }
    if (url.pathname === "/api/items" && request.method() === "GET") {
      const query = url.searchParams.get("q")?.trim().toLowerCase();
      return json(route, {
        items: query
          ? items.filter((item) =>
              `${item.title} ${item.description} ${item.bodyText}`
                .toLowerCase()
                .includes(query),
            )
          : items,
      });
    }
    if (url.pathname.startsWith("/api/items/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/items/".length));
      return json(route, {
        item: items.find((item) => item.id === id) ?? items[0],
      });
    }
    return json(route, {});
  });
}

async function screenshot(page: Page, name: string) {
  await mkdir(captureDir!, { recursive: true });
  await page.screenshot({
    path: `${captureDir}/${name}_${captureState}.png`,
    fullPage: false,
  });
}

async function voiceScreenshot(page: Page, name: string) {
  await mkdir(captureDir!, { recursive: true });
  await page.screenshot({
    path: `${captureDir}/${name}.png`,
    fullPage: false,
  });
}

test("captures the requested Recall voice states", async ({ page }) => {
  test.skip(
    process.env.RECALL_VOICE_SCREENSHOTS !== "1",
    "Voice screenshot harness",
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop() {} }],
        }),
      },
    });
    class ScreenshotSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onend: (() => void) | null = null;
      start() {}
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    Object.assign(window, {
      SpeechRecognition: ScreenshotSpeechRecognition,
      webkitSpeechRecognition: ScreenshotSpeechRecognition,
    });
    localStorage.removeItem("recall.voiceAnswers");
  });
  await mockRecall(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("assistant-ring-desktop")).toBeVisible();
  await page.waitForTimeout(800);
  await voiceScreenshot(page, "desktop-ready");
  await page.getByTestId("ask-bar-mic").click();
  await expect(page.getByTestId("assistant-ring-desktop")).toHaveClass(
    /is-listening/,
  );
  await page.waitForTimeout(350);
  await voiceScreenshot(page, "desktop-listening");
  await page.getByTestId("ask-bar-mic").click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId("assistant-ring-mobile")).toBeVisible();
  await page.waitForTimeout(800);
  await voiceScreenshot(page, "mobile-ready");
  await page.getByTestId("ask-bar-mic").click();
  await expect(page.getByTestId("assistant-ring-mobile")).toHaveClass(
    /is-listening/,
  );
  await page.waitForTimeout(350);
  await voiceScreenshot(page, "mobile-listening");
});

test("captures the requested Recall states", async ({ page }) => {
  await mockRecall(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("knowledge-graph")).toBeVisible();
  await page.waitForTimeout(2_000);
  await screenshot(page, "graph_desktop");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId("knowledge-graph")).toBeVisible();
  await page.waitForTimeout(2_000);
  await screenshot(page, "graph_mobile");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/notes");
  const notesSearch = page.getByPlaceholder(
    "Search notes (title, body, tags)...",
  );
  await notesSearch.fill("oil change");
  await page.waitForTimeout(400);
  const oilChangeResult = page.getByText("Subaru service log", { exact: true });
  if (await oilChangeResult.count()) {
    await oilChangeResult.click();
    await expect(page.getByText(/Completed an oil change/)).toBeVisible();
  }
  await screenshot(page, "notes_oil_change");

  await page.goto("/");
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await expect(page.getByTestId("item-search")).toBeVisible();
  await expect(page.getByTestId("item-card").first()).toBeVisible();
  await screenshot(page, "grid_capture_overlap");

  for (const viewport of [
    { label: "desktop", width: 1280, height: 800 },
    { label: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/");
    const ask = page.getByLabel("Ask Recall");
    await ask.fill("permit");
    await ask.press("Enter");
    await page.waitForTimeout(250);
    await screenshot(page, `ask_enter_${viewport.label}`);

    const askAi = page.getByRole("button", { name: "Ask AI", exact: true });
    if (await askAi.count()) {
      await askAi.click();
      await expect(page.getByTestId("ask-output-panel")).toContainText(
        "Permit approved",
      );
    }
    await screenshot(page, `ask_ai_${viewport.label}`);
  }
});
