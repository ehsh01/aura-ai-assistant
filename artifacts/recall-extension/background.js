/**
 * Background service worker — owns auth, dedupe, network, and retry queue.
 * Content scripts only observe approved pages and send structured candidates.
 */

import { isAllowedHost, classifyHost } from "./lib/hosts.js";
import {
  FINGERPRINT_HISTORY_KEY,
  hasRecentFingerprint,
  rememberFingerprint,
  pruneFingerprintHistory,
} from "./lib/fingerprint.js";
import { buildCaptureBody, sourceLabelFor } from "./lib/capture-body.js";

const RETRY_QUEUE_KEY = "recallCaptureRetryQueue";
const MAX_QUEUE = 40;
const SETTINGS_DEFAULTS = {
  recallToken: "",
  recallApiBase: "https://recall-app.net/api",
  autoCaptureEnabled: false,
  lastAutoCaptureAt: null,
  lastAutoCaptureSource: null,
};

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(SETTINGS_DEFAULTS));
  return { ...SETTINGS_DEFAULTS, ...stored };
}

async function readRetryQueue() {
  const stored = await chrome.storage.local.get([RETRY_QUEUE_KEY]);
  return Array.isArray(stored[RETRY_QUEUE_KEY]) ? stored[RETRY_QUEUE_KEY] : [];
}

async function writeRetryQueue(items) {
  await chrome.storage.local.set({
    [RETRY_QUEUE_KEY]: items.slice(-MAX_QUEUE),
  });
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

async function postCapture(apiBase, token, body) {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/captures`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return res;
}

async function flushRetryQueue(apiBase, token) {
  const queue = await readRetryQueue();
  if (queue.length === 0) return 0;
  const remaining = [];
  let sent = 0;
  for (let i = 0; i < queue.length; i += 1) {
    const item = queue[i];
    try {
      const res = await postCapture(apiBase, token, item.body);
      if (res.status === 401) {
        remaining.push(item, ...queue.slice(i + 1));
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

async function readFingerprints() {
  const stored = await chrome.storage.local.get([FINGERPRINT_HISTORY_KEY]);
  return pruneFingerprintHistory(
    Array.isArray(stored[FINGERPRINT_HISTORY_KEY])
      ? stored[FINGERPRINT_HISTORY_KEY]
      : [],
  );
}

async function writeFingerprints(history) {
  await chrome.storage.local.set({ [FINGERPRINT_HISTORY_KEY]: history });
}

/**
 * @param {object} candidate
 * @param {"automatic" | "manual"} mode
 */
async function submitCandidate(candidate, mode) {
  const settings = await getSettings();
  const token = String(settings.recallToken || "").trim();
  const apiBase = String(settings.recallApiBase || SETTINGS_DEFAULTS.recallApiBase)
    .trim()
    .replace(/\/$/, "");

  if (!token) {
    return { ok: false, error: "Paste your Recall extension token in Settings first." };
  }

  if (mode === "automatic" && !settings.autoCaptureEnabled) {
    return { ok: false, skipped: true, error: "Automatic capture is off." };
  }

  const hostname = candidate.hostname || "";
  if (!isAllowedHost(hostname)) {
    return {
      ok: false,
      error:
        "Automatic and manual capture only work on Outlook Web and Teams Web.",
    };
  }

  const fingerprint = candidate.fingerprint;
  if (mode === "automatic" && fingerprint) {
    const history = await readFingerprints();
    if (hasRecentFingerprint(history, fingerprint)) {
      return { ok: true, duplicate: true };
    }
  }

  const body = buildCaptureBody(candidate, mode);

  try {
    const flushed = await flushRetryQueue(apiBase, token);
    const res = await postCapture(apiBase, token, body);
    if (res.status === 401) {
      return {
        ok: false,
        error: "Token rejected — paste a fresh token from Connectors.",
      };
    }
    if (!res.ok) {
      await enqueueFailedCapture(body);
      const pending = (await readRetryQueue()).length;
      return {
        ok: false,
        queued: true,
        error: `Queued offline (${pending}). HTTP ${res.status}`,
      };
    }

    if (fingerprint) {
      const history = await readFingerprints();
      await writeFingerprints(rememberFingerprint(history, fingerprint));
    }

    if (mode === "automatic") {
      const source = candidate.source || classifyHost(hostname);
      await chrome.storage.local.set({
        lastAutoCaptureAt: new Date().toISOString(),
        lastAutoCaptureSource: sourceLabelFor(source, "automatic"),
      });
    }

    return {
      ok: true,
      flushed,
      sourceName: body.sourceName,
    };
  } catch (err) {
    await enqueueFailedCapture(body);
    const pending = (await readRetryQueue()).length;
    return {
      ok: false,
      queued: true,
      error: `Queued offline (${pending}). ${
        err instanceof Error ? err.message : "Network error"
      }`,
    };
  }
}

async function captureActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    return { ok: false, error: "No active tab." };
  }

  let hostname = "";
  try {
    hostname = new URL(tab.url).hostname;
  } catch {
    return {
      ok: false,
      error:
        "Automatic and manual capture only work on Outlook Web and Teams Web.",
    };
  }

  if (!isAllowedHost(hostname)) {
    return {
      ok: false,
      error:
        "Automatic and manual capture only work on Outlook Web and Teams Web.",
    };
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: "extract_for_manual" });
  } catch {
    return {
      ok: false,
      error:
        "Could not reach this page. Reload the Outlook or Teams tab and try again.",
    };
  }

  if (!response?.ok || !response.candidate) {
    return {
      ok: false,
      error: response?.error || "Nothing to capture on this page.",
    };
  }

  return submitCandidate(response.candidate, "manual");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;

  if (type === "automatic_capture_candidate") {
    void submitCandidate(message.candidate, "automatic").then(() => {
      // Auto path is silent — popup status covers last success.
    });
    return false;
  }

  if (type === "get_status") {
    void getSettings().then(async (settings) => {
      const queue = await readRetryQueue();
      sendResponse({
        autoCaptureEnabled: Boolean(settings.autoCaptureEnabled),
        signedIn: Boolean(String(settings.recallToken || "").trim()),
        apiBase: settings.recallApiBase,
        lastAutoCaptureAt: settings.lastAutoCaptureAt,
        lastAutoCaptureSource: settings.lastAutoCaptureSource,
        queuedCount: queue.length,
      });
    });
    return true;
  }

  if (type === "set_auto_capture") {
    void chrome.storage.local
      .set({ autoCaptureEnabled: Boolean(message.enabled) })
      .then(() => sendResponse({ ok: true, enabled: Boolean(message.enabled) }));
    return true;
  }

  if (type === "save_settings") {
    void (async () => {
      const token = String(message.token || "").trim();
      const apiBase =
        String(message.apiBase || SETTINGS_DEFAULTS.recallApiBase)
          .trim()
          .replace(/\/$/, "") || SETTINGS_DEFAULTS.recallApiBase;
      await chrome.storage.local.set({
        recallToken: token,
        recallApiBase: apiBase,
      });
      let flushed = 0;
      if (token) {
        flushed = await flushRetryQueue(apiBase, token);
      }
      sendResponse({ ok: true, flushed });
    })();
    return true;
  }

  if (type === "manual_capture") {
    void captureActiveTab().then(sendResponse);
    return true;
  }

  if (type === "get_settings") {
    void getSettings().then(sendResponse);
    return true;
  }

  return false;
});

chrome.alarms.create("recallFlushQueue", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "recallFlushQueue") return;
  void getSettings().then(async (settings) => {
    const token = String(settings.recallToken || "").trim();
    if (!token) return;
    await flushRetryQueue(settings.recallApiBase, token);
  });
});

// Ensure default auto-capture is off on install/update.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.get(["autoCaptureEnabled"]).then((stored) => {
    if (typeof stored.autoCaptureEnabled !== "boolean") {
      void chrome.storage.local.set({ autoCaptureEnabled: false });
    }
  });
});
