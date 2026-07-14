const tokenEl = document.getElementById("token");
const apiBaseEl = document.getElementById("apiBase");
const statusEl = document.getElementById("status");
const captureBtn = document.getElementById("capture");
const saveBtn = document.getElementById("save");
const openAppBtn = document.getElementById("openApp");
const authDot = document.getElementById("authDot");
const authLabel = document.getElementById("authLabel");
const settingsEl = document.getElementById("settings");

const RETRY_QUEUE_KEY = "recallCaptureRetryQueue";
const MAX_QUEUE = 40;

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

function refreshAuthUi(token) {
  const signedIn = Boolean(token?.trim());
  captureBtn.disabled = !signedIn;
  authDot.classList.toggle("off", !signedIn);
  authLabel.textContent = signedIn ? "Signed in" : "Not signed in";
  if (!signedIn) settingsEl.open = true;
}

function classifyPageSource(hostname, url) {
  const host = (hostname || "").toLowerCase();
  const href = (url || "").toLowerCase();
  if (
    host.includes("outlook.office.com") ||
    host.includes("outlook.live.com") ||
    host.includes("outlook.office365.com") ||
    href.includes("outlook.office.com")
  ) {
    return { sourceType: "browser_extension", sourceName: "Outlook Web" };
  }
  if (
    host.includes("teams.microsoft.com") ||
    host.includes("teams.live.com") ||
    href.includes("teams.microsoft.com")
  ) {
    return { sourceType: "browser_extension", sourceName: "Teams Web" };
  }
  return { sourceType: "browser_extension", sourceName: hostname || "browser" };
}

async function readRetryQueue() {
  const stored = await chrome.storage.local.get([RETRY_QUEUE_KEY]);
  const list = stored[RETRY_QUEUE_KEY];
  return Array.isArray(list) ? list : [];
}

async function writeRetryQueue(items) {
  await chrome.storage.local.set({ [RETRY_QUEUE_KEY]: items.slice(-MAX_QUEUE) });
}

async function enqueueFailedCapture(body) {
  const queue = await readRetryQueue();
  queue.push({
    id: `xq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    body,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  await writeRetryQueue(queue);
}

async function flushRetryQueue(apiBase, token) {
  const queue = await readRetryQueue();
  if (queue.length === 0) return 0;
  const remaining = [];
  let sent = 0;
  for (const item of queue) {
    try {
      const res = await fetch(`${apiBase}/captures`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(item.body),
      });
      if (res.status === 401) {
        remaining.push(item);
        remaining.push(...queue.slice(queue.indexOf(item) + 1));
        break;
      }
      if (!res.ok) {
        item.attempts = (item.attempts || 0) + 1;
        if (item.attempts < 5) remaining.push(item);
        continue;
      }
      sent += 1;
    } catch {
      item.attempts = (item.attempts || 0) + 1;
      if (item.attempts < 5) remaining.push(item);
    }
  }
  await writeRetryQueue(remaining);
  return sent;
}

chrome.storage.local.get(["recallToken", "recallApiBase"], (stored) => {
  if (stored.recallToken) tokenEl.value = stored.recallToken;
  if (stored.recallApiBase) apiBaseEl.value = stored.recallApiBase;
  refreshAuthUi(stored.recallToken);
  const token = stored.recallToken?.trim();
  const apiBase = (stored.recallApiBase || apiBaseEl.value || "").trim().replace(/\/$/, "");
  if (token && apiBase) {
    void flushRetryQueue(apiBase, token).then((sent) => {
      if (sent > 0) setStatus(`Flushed ${sent} queued capture(s).`, "ok");
    });
  }
});

async function saveSettings() {
  const token = tokenEl.value.trim();
  const apiBase = apiBaseEl.value.trim().replace(/\/$/, "") || "https://recall-app.net/api";
  apiBaseEl.value = apiBase;
  await chrome.storage.local.set({ recallToken: token, recallApiBase: apiBase });
  refreshAuthUi(token);
  setStatus(token ? "Saved. Ready to capture." : "Token cleared.", token ? "ok" : "");
}

saveBtn.addEventListener("click", () => {
  void saveSettings();
});

openAppBtn.addEventListener("click", () => {
  const base = (apiBaseEl.value.trim() || "https://recall-app.net/api").replace(/\/api\/?$/, "");
  chrome.tabs.create({ url: `${base}/connectors` });
});

captureBtn.addEventListener("click", async () => {
  setStatus("Capturing…");
  const token = tokenEl.value.trim();
  const apiBase = apiBaseEl.value.trim().replace(/\/$/, "");
  await chrome.storage.local.set({ recallToken: token, recallApiBase: apiBase });
  refreshAuthUi(token);

  if (!token) {
    setStatus("Paste your Recall token in Settings first.", "err");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("No active tab.", "err");
    return;
  }

  let payload;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const hostname = location.hostname;
        const href = location.href;
        const isOutlook =
          hostname.includes("outlook.") || href.includes("outlook.office");
        const isTeams =
          hostname.includes("teams.microsoft") ||
          hostname.includes("teams.live") ||
          href.includes("teams.microsoft");

        const textOf = (sel) =>
          Array.from(document.querySelectorAll(sel))
            .map((el) => el.textContent?.trim() || "")
            .find((t) => t.length > 0) || "";

        let subject = "";
        let from = "";
        let channel = "";
        let bodySnippet = "";

        if (isOutlook) {
          subject =
            textOf('[aria-label="Subject"]') ||
            textOf('[data-automation-id="ConversationReadingPaneSubject"]') ||
            textOf("div[role='heading']") ||
            document.querySelector("h1")?.textContent?.trim() ||
            "";
          from =
            textOf('[aria-label*="From"]') ||
            textOf('[data-testid="RecipientWell"]') ||
            textOf(".allowTextSelection") ||
            "";
          bodySnippet =
            textOf('[aria-label="Message body"]') ||
            document.querySelector('[role="document"]')?.innerText?.slice(0, 6000) ||
            "";
        } else if (isTeams) {
          channel =
            textOf('[data-tid="chat-header-title"]') ||
            textOf('[data-tid="channel-name"]') ||
            document.title;
          const selected = window.getSelection()?.toString()?.trim() || "";
          const lastMsg =
            Array.from(document.querySelectorAll('[data-tid="message-body"], [data-tid="chat-pane-message"]'))
              .map((el) => el.textContent?.trim() || "")
              .filter(Boolean)
              .slice(-3)
              .join("\n---\n");
          bodySnippet = selected || lastMsg;
          from =
            textOf('[data-tid="message-author-name"]') ||
            textOf('[data-tid="message-header"] span') ||
            "";
          subject = channel || document.title;
        } else {
          subject = document.querySelector("h1")?.textContent?.trim() || "";
          from =
            document.querySelector('[aria-label*="From"]')?.textContent?.trim() ||
            document.querySelector(".allowTextSelection")?.textContent?.trim() ||
            "";
        }

        return {
          url: href,
          title: document.title,
          hostname,
          selectedText: window.getSelection()?.toString() ?? "",
          visibleText: (bodySnippet || document.body?.innerText || "").slice(0, 8000),
          subject,
          from,
          channel,
          collector: isOutlook ? "outlook_web" : isTeams ? "teams_web" : "generic",
          timestamp: new Date().toISOString(),
        };
      },
    });
    payload = result;
  } catch (err) {
    setStatus(
      `Could not read this page: ${err instanceof Error ? err.message : "unknown error"}`,
      "err",
    );
    return;
  }

  const pageSource = classifyPageSource(payload.hostname, payload.url);
  const bits = [];
  if (payload.subject) bits.push(`Subject: ${payload.subject}`);
  if (payload.from) bits.push(`From: ${payload.from}`);
  if (payload.channel) bits.push(`Channel: ${payload.channel}`);
  const rawText = payload.selectedText?.trim()
    ? payload.selectedText
    : `${payload.title}\n${bits.join("\n")}\n\n${payload.visibleText}`.trim();

  const body = {
    rawText,
    sourceType: pageSource.sourceType,
    sourceName: pageSource.sourceName,
    sourceUrl: payload.url,
    title: payload.title,
    rawMetadata: {
      ...payload,
      sourceLabel: pageSource.sourceName,
      collector: payload.collector || "generic",
    },
    capturedAt: payload.timestamp,
  };

  try {
    const flushed = await flushRetryQueue(apiBase, token);
    const res = await fetch(`${apiBase}/captures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      setStatus("Token rejected — paste a fresh token from Connectors.", "err");
      refreshAuthUi("");
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const suffix = flushed > 0 ? ` Also sent ${flushed} queued.` : "";
    setStatus(`Sent to Recall (${pageSource.sourceName}). Check AI Inbox shortly.${suffix}`, "ok");
  } catch (err) {
    await enqueueFailedCapture(body);
    const pending = (await readRetryQueue()).length;
    setStatus(
      `Queued offline (${pending}). Will retry next capture. ${
        err instanceof Error ? err.message : ""
      }`.trim(),
      "err",
    );
  }
});
