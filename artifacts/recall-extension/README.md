# Recall Browser Extension

Privacy-restricted collector for **Outlook Web** and **Teams Web**. Sends raw message context to `POST /api/captures`; Recall performs normalization and AI extraction server-side. The extension never runs AI in the browser and never takes screenshots.

## Supported sites

Automatic and manual capture work only on:

- Outlook Web: `outlook.office.com`, `outlook.office365.com`, `outlook.live.com`
- Teams Web: `teams.microsoft.com`, `teams.live.com`

Other websites are not observed. There is no `<all_urls>` permission.

## Load unpacked (Chrome/Edge)

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select `artifacts/recall-extension`
4. In Recall → **Connectors**, click **Create and copy token**
5. Open the extension popup → Settings → paste the token → Save
6. Optional: turn on **Automatic capture** (default is **off**)
7. Open an email in Outlook Web or a chat in Teams Web, or click **Capture current tab**

## Automatic capture

- **Default: off.** You must enable it in the popup.
- When on, the content script watches only approved Outlook/Teams pages.
- It captures context that becomes visible after **you** open an email or conversation (read pane / chat messages).
- It does **not** open mail for you, mark items read, scrape the inbox in bulk, or send screenshots.
- Each capture is a proposed Recall review item (AI Inbox). Downstream extraction happens on the server.
- Duplicates are suppressed locally via a short-lived fingerprint history (tab refresh / re-open).
- Source labels: `Outlook Web — automatic` / `Teams Web — automatic`.

## Manual capture

The **Capture current tab** button remains as a fallback. It only works on the approved Outlook/Teams hosts and uses the same content-script extractors.

## Permissions

- `storage` — token, auto-capture preference, retry queue, fingerprint history
- `alarms` — periodic flush of the offline retry queue
- `activeTab` — identify the tab when you click Capture
- Host permissions — Outlook Web, Teams Web, and the Recall API only

## Privacy boundaries

- No monitoring of arbitrary browsing
- No Graph API / Microsoft account OAuth in this extension
- Capture-only extension token (`capture:create`); not your full Recall session
- Popup status shows last automatic capture **time and source label only** — never message content

## API

Posts to `/api/captures` with `sourceType: browser_extension` and metadata:

- `collector`: `outlook_web` | `teams_web`
- `captureMode`: `automatic` | `manual`
- `fingerprint`: local dedupe key (also stored in metadata for future server use)

## Tests

From the extension folder (uses the workspace Vitest binary):

```bash
cd artifacts/recall-extension
npm test
```

Covers host allowlisting, fingerprint stability/expiry, and capture-body labeling.

## Known limitations

Outlook and Teams change their DOM often. Extraction uses multiple selectors and fails soft when a pane is empty or too short. If Capture finds nothing, open the message fully and try again; selectors may need periodic updates.
