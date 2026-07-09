# Recall Browser Extension

Lightweight collector per `docs/17_Browser_Extension_Spec.md`. Sends raw page context to `POST /api/captures`; Recall performs normalization and AI extraction server-side.

## Load unpacked (Chrome/Edge)

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select `artifacts/recall-extension`
4. In Recall → **Connectors**, click **Copy extension token**
5. Paste the token into the extension popup Settings and Save
6. Click **Capture current tab** on any page

## Permissions

- `activeTab` + `scripting` — capture is user-initiated on click
- No background scraping

## API

Posts to `/api/captures` with `sourceType: browser_extension`.
