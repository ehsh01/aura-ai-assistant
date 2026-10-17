import { createServer } from "node:http";

const now = "2026-10-17T12:00:00.000Z";
const topics = [
  ["Permit revision approved", "House Projects", "permits", "recall", "note"],
  ["Sales suite launch notes", "Work", "sales", "evernote", "note"],
  ["Elantra maintenance log", "Vehicles", "vehicles", "evernote", "note"],
  ["Holographic interface research", "Product", "design", "recall", "link"],
  ["Kitchen moodboard", "House Projects", "inspiration", "recall", "image"],
  ["Quarterly finance review", "Finance", "finance", "evernote", "note"],
  ["Recruiting plan", "Work", "people", "recall", "note"],
  ["Recall architecture", "Product", "concepts", "recall", "link"],
];

const items = Array.from({ length: 64 }, (_, index) => {
  const [title, notebook, tag, source, kind] = topics[index % topics.length];
  return {
    id: `demo-${index}`,
    kind,
    state: "ready",
    source,
    title: `${title}${index > 7 ? ` ${index + 1}` : ""}`,
    description:
      index % 3 === 0
        ? "Evidence, decisions, and next steps saved in Recall."
        : null,
    domain: kind === "link" ? (index % 2 ? "recall-app.net" : "example.com") : null,
    sourceUrl: kind === "link" ? `https://example.com/research/${index}` : null,
    bodyText:
      `${title}. This saved item connects related notes through tags and notebooks without embeddings or background AI.`,
    media: {},
    tags: [tag, index % 2 ? "active" : "reference", "year:2026"],
    notebook,
    trashed: false,
    bumpedAt: now,
    createdAt: now,
    updatedAt: now,
  };
});

function response(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

function graph(typesParam) {
  const allowed = new Set(
    typesParam?.split(",") ?? ["notes", "notebooks", "tags", "links", "files", "evernote"],
  );
  const nodes = [];
  const edges = [];
  const hubs = new Map();
  for (const [index, item] of items.entries()) {
    const type =
      item.source === "evernote"
        ? "evernote"
        : item.kind === "link"
          ? "links"
          : item.kind === "image"
            ? "files"
            : "notes";
    if (!allowed.has(type)) continue;
    const itemNode = {
      id: `item-node:${item.id}`,
      itemId: item.id,
      type,
      label: item.title,
      value: 5 + (index % 8),
      hub: false,
      href: `/everything/${item.id}`,
    };
    nodes.push(itemNode);
    for (const [hubType, label] of [
      ["notebooks", item.notebook],
      ["tags", item.tags[0]],
    ]) {
      if (!allowed.has(hubType)) continue;
      const hubId = `${hubType}:${label}`;
      if (!hubs.has(hubId)) {
        const hub = {
          id: hubId,
          itemId: null,
          type: hubType,
          label,
          value: hubType === "notebooks" ? 14 : 10,
          hub: true,
          href: `/everything?${hubType === "tags" ? "tag" : "notebook"}=${encodeURIComponent(label)}`,
        };
        hubs.set(hubId, hub);
        nodes.push(hub);
      }
      edges.push({
        id: `${itemNode.id}~${hubId}`,
        source: itemNode.id,
        target: hubId,
        signal: hubType === "tags" ? "tag" : "notebook",
      });
    }
  }
  return {
    nodes: nodes.slice(0, 350),
    edges: edges.filter(
      (edge) =>
        nodes.slice(0, 350).some((node) => node.id === edge.source) &&
        nodes.slice(0, 350).some((node) => node.id === edge.target),
    ),
    page: { offset: 0, limit: 350, nextOffset: null },
  };
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1:5008");
  if (url.pathname === "/api/healthz" || url.pathname === "/api/ready") {
    return response(res, 200, { status: "ok" });
  }
  if (url.pathname === "/api/auth/me") {
    return response(res, 200, {
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "ernesto@example.com",
        name: "Ernesto",
        isAdmin: true,
      },
    });
  }
  if (url.pathname === "/api/notes") return response(res, 200, { notes: [] });
  if (url.pathname === "/api/tasks") return response(res, 200, { tasks: [] });
  if (url.pathname === "/api/notebooks") return response(res, 200, { notebooks: [] });
  if (url.pathname === "/api/home") return response(res, 200, { review: {} });
  if (url.pathname === "/api/finance/refresh") {
    return response(res, 200, { ok: true, synced: false, skipped: true });
  }
  if (url.pathname === "/api/items/facets") {
    return response(res, 200, {
      tags: [...new Set(items.flatMap((item) => item.tags))],
      notebooks: [...new Set(items.map((item) => item.notebook))],
    });
  }
  if (url.pathname === "/api/items/graph") {
    return response(res, 200, graph(url.searchParams.get("types")));
  }
  if (url.pathname === "/api/items" && req.method === "GET") {
    const q = url.searchParams.get("q")?.toLowerCase();
    const source = url.searchParams.get("source");
    const tag = url.searchParams.get("tag");
    const notebook = url.searchParams.get("notebook");
    return response(res, 200, {
      items: items.filter(
        (item) =>
          (!q || `${item.title} ${item.bodyText}`.toLowerCase().includes(q)) &&
          (!source || item.source === source) &&
          (!tag || item.tags.includes(tag)) &&
          (!notebook || item.notebook === notebook),
      ),
    });
  }
  if (url.pathname === "/api/items" && req.method === "POST") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const { value } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const item = { ...items[0], id: `demo-${Date.now()}`, title: value, bodyText: value };
      items.unshift(item);
      response(res, 201, { item, existing: false });
    });
    return;
  }
  if (url.pathname.startsWith("/api/items/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/items/".length));
    const item = items.find((candidate) => candidate.id === id);
    return response(res, item ? 200 : 404, item ? { item } : { message: "Not found" });
  }
  if (url.pathname === "/api/ai/query/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`event: meta\ndata: ${JSON.stringify({ threadId: "demo", evidence: [], relatedRecords: [] })}\n\n`);
    const words = ["Your", " saved", " knowledge", " is", " connected", " by", " notebooks", " and", " tags."];
    let index = 0;
    const timer = setInterval(() => {
      if (index < words.length) {
        res.write(`event: token\ndata: ${JSON.stringify({ delta: words[index++] })}\n\n`);
      } else {
        clearInterval(timer);
        res.write(`event: done\ndata: ${JSON.stringify({ answer: words.join(""), confidence: 0.9 })}\n\n`);
        res.end();
      }
    }, 120);
    return;
  }
  response(res, 200, {});
});

server.listen(5008, "127.0.0.1", () => {
  console.log("Recall demo API listening on http://127.0.0.1:5008");
});
