/**
 * Defensive DOM extractors for Outlook Web and Teams Web.
 * Multiple selectors — Microsoft changes these often; fail soft when empty.
 */

/** Minimum body length before we treat a pane as a real opened message. */
export const MIN_BODY_CHARS = 80;

/**
 * @param {ParentNode | Document} root
 * @param {string[]} selectors
 */
export function firstText(root, selectors) {
  for (const sel of selectors) {
    try {
      const nodes = root.querySelectorAll(sel);
      for (const el of nodes) {
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (text) return text;
      }
    } catch {
      // Invalid selector in this browser — skip.
    }
  }
  return "";
}

/**
 * Prefer the largest plausible body region; avoids tiny nav fragments.
 * @param {ParentNode | Document} root
 * @param {string[]} selectors
 * @param {number} [maxChars]
 */
export function bestBodyText(root, selectors, maxChars = 8000) {
  let best = "";
  for (const sel of selectors) {
    try {
      for (const el of root.querySelectorAll(sel)) {
        const text = (el.innerText || el.textContent || "").trim();
        if (text.length > best.length) best = text;
      }
    } catch {
      // skip
    }
  }
  return best.slice(0, maxChars);
}

/**
 * @param {Document} doc
 */
export function extractOutlook(doc) {
  const subject = firstText(doc, [
    '[data-automation-id="ConversationReadingPaneSubject"]',
    '[aria-label="Subject"]',
    'div[role="heading"][aria-level="1"]',
    'div[role="heading"]',
    "h1",
  ]);

  const sender = firstText(doc, [
    '[aria-label^="From"]',
    '[aria-label*="From"]',
    '[data-testid="RecipientWell"]',
    'span[class*="from"]',
  ]);

  const timestamp = firstText(doc, [
    'span[title*="20"]',
    '[aria-label*="Sent"]',
    'time',
  ]);

  const body = bestBodyText(doc, [
    '[aria-label="Message body"]',
    '[role="document"]',
    'div[aria-label*="Message body"]',
    ".allowTextSelection",
  ]);

  return {
    source: /** @type {const} */ ("outlook"),
    subject,
    channel: "",
    sender,
    body,
    timestamp: timestamp || null,
  };
}

/**
 * @param {Document} doc
 * @param {string} [selectedText]
 */
export function extractTeams(doc, selectedText = "") {
  const channel = firstText(doc, [
    '[data-tid="chat-header-title"]',
    '[data-tid="channel-name"]',
    '[data-tid="thread-header-title"]',
    "h1",
  ]);

  const sender = firstText(doc, [
    '[data-tid="message-author-name"]',
    '[data-tid="message-header"] span',
    '[data-tid="threaded-message-author-name"]',
  ]);

  const timestamp = firstText(doc, [
    '[data-tid="message-timestamp"]',
    "time",
  ]);

  let body = (selectedText || "").trim();
  if (!body) {
    const messages = [];
    for (const sel of [
      '[data-tid="message-body"]',
      '[data-tid="chat-pane-message"]',
      '[data-tid="message-body-content"]',
    ]) {
      try {
        for (const el of doc.querySelectorAll(sel)) {
          const text = (el.innerText || el.textContent || "").trim();
          if (text) messages.push(text);
        }
      } catch {
        // skip
      }
    }
    // Last few visible messages — user opened this conversation; do not dump the whole history.
    body = messages.slice(-3).join("\n---\n");
  }

  return {
    source: /** @type {const} */ ("teams"),
    subject: channel,
    channel,
    sender,
    body: body.slice(0, 8000),
    timestamp: timestamp || null,
  };
}

/**
 * @param {Document} doc
 * @param {"outlook" | "teams"} kind
 * @param {{ selectedText?: string }} [opts]
 */
export function extractOpenedContext(doc, kind, opts = {}) {
  const base =
    kind === "outlook"
      ? extractOutlook(doc)
      : extractTeams(doc, opts.selectedText || "");

  const body = (base.body || "").trim();
  if (body.length < MIN_BODY_CHARS) {
    return null;
  }

  return {
    ...base,
    body,
    title: doc.title || base.subject || base.channel || "",
    url: doc.defaultView?.location?.href || "",
    hostname: doc.defaultView?.location?.hostname || "",
    selectedText: (opts.selectedText || "").trim(),
  };
}
