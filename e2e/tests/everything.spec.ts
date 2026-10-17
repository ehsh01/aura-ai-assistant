import { expect, test, type Page, type Route } from "@playwright/test";

const now = "2026-10-17T12:00:00.000Z";
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

async function mockRecall(page: Page) {
  const items = [...baseItems];
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
    if (url.pathname === "/api/notebooks") return json(route, { notebooks: [] });
    if (url.pathname === "/api/home") return json(route, { review: {} });
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
      const graphNodes = items.flatMap((item, index) => [
        {
          id: `item-node:${item.id}`,
          itemId: item.id,
          type: item.source === "evernote" ? "evernote" : "notes",
          label: item.title,
          value: 8 + index,
          hub: false,
          href: `/everything/${item.id}`,
        },
        {
          id: `tag:${index}`,
          itemId: null,
          type: "tags",
          label: item.tags[0],
          value: 10,
          hub: true,
          href: `/everything?tag=${item.tags[0]}`,
        },
      ]);
      return json(route, {
        nodes: graphNodes,
        edges: items.map((item, index) => ({
          id: `edge-${index}`,
          source: `item-node:${item.id}`,
          target: `tag:${index}`,
          signal: "tag",
        })),
        page: { offset: 0, limit: 350, nextOffset: null },
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
      return item ? json(route, { item }) : json(route, { message: "Not found" }, 404);
    }
    return json(route, {});
  });
}

test.describe("Everything capture, graph, grid, and search", () => {
  test("saves a note, browses masonry, filters instantly, and opens detail", async ({ page }) => {
    await mockRecall(page);
    await page.goto("/");

    await expect(page.getByTestId("knowledge-graph")).toBeVisible();
    await expect(page.getByLabel("Save anything")).toBeVisible();

    await page.getByLabel("Save anything").fill("Contractor callback");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved to Recall", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Grid", exact: true }).click();
    await expect(page.getByTestId("masonry-grid")).toBeVisible();
    await expect(
      page.getByTestId("masonry-grid").getByText("Contractor callback", { exact: true }),
    ).toBeVisible();

    await page.getByTestId("item-search").fill("permit");
    await expect(page.getByText("Permit revision", { exact: true })).toBeVisible();
    await expect(page.getByText("Sales meeting notes", { exact: true })).toBeHidden();

    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await expect(page.getByTestId("search-filters")).toBeVisible();
    await page.getByText("Permit revision", { exact: true }).click();
    await expect(page.getByTestId("item-detail")).toContainText("City approval");
  });
});
