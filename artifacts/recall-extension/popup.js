const tokenEl = document.getElementById("token");
const apiBaseEl = document.getElementById("apiBase");
const statusEl = document.getElementById("status");
const captureBtn = document.getElementById("capture");
const saveBtn = document.getElementById("save");
const openAppBtn = document.getElementById("openApp");
const authDot = document.getElementById("authDot");
const authLabel = document.getElementById("authLabel");
const settingsEl = document.getElementById("settings");

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

chrome.storage.local.get(["recallToken", "recallApiBase"], (stored) => {
  if (stored.recallToken) tokenEl.value = stored.recallToken;
  if (stored.recallApiBase) apiBaseEl.value = stored.recallApiBase;
  refreshAuthUi(stored.recallToken);
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
      func: () => ({
        url: location.href,
        title: document.title,
        hostname: location.hostname,
        selectedText: window.getSelection()?.toString() ?? "",
        visibleText: document.body?.innerText?.slice(0, 8000) ?? "",
        timestamp: new Date().toISOString(),
      }),
    });
    payload = result;
  } catch (err) {
    setStatus(
      `Could not read this page: ${err instanceof Error ? err.message : "unknown error"}`,
      "err",
    );
    return;
  }

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
    if (res.status === 401) {
      setStatus("Token rejected — paste a fresh token from Connectors.", "err");
      refreshAuthUi("");
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus("Sent to Recall. Check AI Inbox shortly.", "ok");
  } catch (err) {
    setStatus(`Failed: ${err instanceof Error ? err.message : "unknown error"}`, "err");
  }
});
