const tokenEl = document.getElementById("token");
const apiBaseEl = document.getElementById("apiBase");
const statusEl = document.getElementById("status");
const captureBtn = document.getElementById("capture");
const saveBtn = document.getElementById("save");
const openAppBtn = document.getElementById("openApp");
const authDot = document.getElementById("authDot");
const authLabel = document.getElementById("authLabel");
const settingsEl = document.getElementById("settings");
const autoToggle = document.getElementById("autoToggle");
const autoLabel = document.getElementById("autoLabel");
const autoMeta = document.getElementById("autoMeta");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

function refreshAuthUi(signedIn) {
  captureBtn.disabled = !signedIn;
  authDot.classList.toggle("off", !signedIn);
  authLabel.textContent = signedIn ? "Signed in" : "Not signed in";
  if (!signedIn) settingsEl.open = true;
}

function formatRelative(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function renderAutoStatus(status) {
  const on = Boolean(status?.autoCaptureEnabled);
  autoToggle.checked = on;
  autoLabel.textContent = on ? "On" : "Off";

  const when = formatRelative(status?.lastAutoCaptureAt);
  const source = status?.lastAutoCaptureSource;
  if (when && source) {
    autoMeta.textContent = `Last automatic: ${when} · ${source}`;
  } else if (on) {
    autoMeta.textContent =
      "On — open an Outlook email or Teams conversation. Creates Recall review items only; no screenshots.";
  } else {
    autoMeta.textContent =
      "Default is off. When on, opening an email or Teams conversation can queue a review item in Recall. Limited to Outlook and Teams only.";
  }
}

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || {});
    });
  });
}

async function refresh() {
  const [status, settings] = await Promise.all([
    send("get_status"),
    send("get_settings"),
  ]);
  if (settings?.recallToken != null) tokenEl.value = settings.recallToken;
  if (settings?.recallApiBase) apiBaseEl.value = settings.recallApiBase;
  refreshAuthUi(Boolean(status?.signedIn));
  renderAutoStatus(status);
  if (status?.queuedCount > 0) {
    setStatus(`${status.queuedCount} capture(s) waiting to retry.`, "");
  }
}

autoToggle.addEventListener("change", () => {
  void send("set_auto_capture", { enabled: autoToggle.checked }).then(() =>
    refresh(),
  );
});

saveBtn.addEventListener("click", () => {
  void (async () => {
    const res = await send("save_settings", {
      token: tokenEl.value.trim(),
      apiBase: apiBaseEl.value.trim(),
    });
    refreshAuthUi(Boolean(tokenEl.value.trim()));
    if (res?.flushed > 0) {
      setStatus(`Saved. Flushed ${res.flushed} queued capture(s).`, "ok");
    } else {
      setStatus(
        tokenEl.value.trim() ? "Saved. Ready to capture." : "Token cleared.",
        tokenEl.value.trim() ? "ok" : "",
      );
    }
    await refresh();
  })();
});

openAppBtn.addEventListener("click", () => {
  const base = (apiBaseEl.value.trim() || "https://recall-app.net/api").replace(
    /\/api\/?$/,
    "",
  );
  chrome.tabs.create({ url: `${base}/connectors` });
});

captureBtn.addEventListener("click", async () => {
  setStatus("Capturing…");
  // Persist fields the user may have edited without clicking Save.
  await send("save_settings", {
    token: tokenEl.value.trim(),
    apiBase: apiBaseEl.value.trim(),
  });
  const res = await send("manual_capture");
  if (res?.ok) {
    const suffix = res.flushed > 0 ? ` Also sent ${res.flushed} queued.` : "";
    setStatus(
      `Sent to Recall (${res.sourceName || "capture"}). Check AI Inbox shortly.${suffix}`,
      "ok",
    );
  } else {
    setStatus(res?.error || "Capture failed.", "err");
  }
  await refresh();
});

void refresh();
