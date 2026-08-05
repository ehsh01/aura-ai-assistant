/**
 * Content script — runs only on approved Outlook / Teams hosts (see manifest).
 * Observes when an opened email/chat pane becomes visible and emits candidates
 * to the background worker. Never calls the Recall API or takes screenshots.
 *
 * Loaded as a classic script so we can dynamically import shared ESM helpers
 * via chrome.runtime.getURL (requires web_accessible_resources for lib/*).
 */

(async () => {
  const { classifyHost, isAllowedHost } = await import(
    chrome.runtime.getURL("lib/hosts.js")
  );
  const { buildFingerprint } = await import(
    chrome.runtime.getURL("lib/fingerprint.js")
  );
  const { extractOpenedContext, MIN_BODY_CHARS } = await import(
    chrome.runtime.getURL("lib/extract.js")
  );

  const DEBOUNCE_MS = 650;
  let debounceTimer = null;
  let lastHref = location.href;
  let lastEmittedFp = "";

  function currentKind() {
    return classifyHost(location.hostname);
  }

  function collectCandidate() {
    if (!isAllowedHost(location.hostname)) return null;
    const kind = currentKind();
    if (!kind) return null;

    const selected = window.getSelection()?.toString() ?? "";
    const extracted = extractOpenedContext(document, kind, {
      selectedText: selected,
    });
    if (!extracted) return null;

    const fingerprint = buildFingerprint({
      source: kind,
      url: extracted.url,
      subjectOrChat: extracted.subject || extracted.channel,
      sender: extracted.sender,
      messageText: extracted.body,
    });

    return {
      ...extracted,
      source: kind,
      fingerprint,
      timestamp: new Date().toISOString(),
    };
  }

  function emitAutomaticCandidate() {
    const candidate = collectCandidate();
    if (!candidate) return;
    if (candidate.fingerprint === lastEmittedFp) return;
    lastEmittedFp = candidate.fingerprint;

    chrome.runtime.sendMessage(
      { type: "automatic_capture_candidate", candidate },
      () => {
        void chrome.runtime.lastError;
      },
    );
  }

  function scheduleCheck() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (location.href !== lastHref) {
        lastHref = location.href;
        lastEmittedFp = "";
      }
      emitAutomaticCandidate();
    }, DEBOUNCE_MS);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "extract_for_manual") {
      try {
        const candidate = collectCandidate();
        if (!candidate) {
          sendResponse({
            ok: false,
            error: `Nothing open to capture yet (need ~${MIN_BODY_CHARS}+ characters of visible message text).`,
          });
          return;
        }
        sendResponse({ ok: true, candidate });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : "Extract failed",
        });
      }
      return true;
    }
    return false;
  });

  const observer = new MutationObserver(() => scheduleCheck());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: false,
  });

  const pushState = history.pushState.bind(history);
  history.pushState = (...args) => {
    pushState(...args);
    scheduleCheck();
  };
  const replaceState = history.replaceState.bind(history);
  history.replaceState = (...args) => {
    replaceState(...args);
    scheduleCheck();
  };
  window.addEventListener("popstate", scheduleCheck);
  window.addEventListener("hashchange", scheduleCheck);

  scheduleCheck();
})();
