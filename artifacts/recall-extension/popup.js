const tokenEl = document.getElementById("token");
const apiBaseEl = document.getElementById("apiBase");
const statusEl = document.getElementById("status");
const captureBtn = document.getElementById("capture");

chrome.storage.local.get(["recallToken", "recallApiBase"], (stored) => {
  if (stored.recallToken) tokenEl.value = stored.recallToken;
  if (stored.recallApiBase) apiBaseEl.value = stored.recallApiBase;
});

captureBtn.addEventListener("click", async () => {
  statusEl.textContent = "Capturing…";
  const token = tokenEl.value.trim();
  const apiBase = apiBaseEl.value.trim().replace(/\/$/, "");
  await chrome.storage.local.set({ recallToken: token, recallApiBase: apiBase });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    statusEl.textContent = "No active tab.";
    return;
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      url: location.href,
      title: document.title,
      hostname: location.hostname,
      selectedText: window.getSelection()?.toString() ?? "",
      visibleText: document.body?.innerText?.slice(0, 8000) ?? "",
      timestamp: new Date().toISOString(),
    }),
  });

  const payload = result;
  const rawText = payload.selectedText?.trim()
    ? payload.selectedText
    : `${payload.title}\n\n${payload.visibleText}`.trim();

  try {
    const res = await fetch(`${apiBase}/captures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        rawText,
        sourceType: "browser_extension",
        sourceName: payload.hostname,
        sourceUrl: payload.url,
        title: payload.title,
        rawMetadata: payload,
        capturedAt: payload.timestamp,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    statusEl.textContent = "Sent to Recall. Check AI Inbox shortly.";
  } catch (err) {
    statusEl.textContent = `Failed: ${err instanceof Error ? err.message : "unknown error"}`;
  }
});
