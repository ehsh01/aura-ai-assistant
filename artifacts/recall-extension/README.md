# Recall Browser Extension (Phase 7 scaffold)

Lightweight collector per `docs/17_Browser_Extension_Spec.md`. Sends raw page context to `POST /api/captures`; Recall performs normalization and AI extraction server-side.

## Load unpacked (Chrome/Edge)

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select `artifacts/recall-extension`
4. Paste your Recall JWT from the web app login into the popup token field

## Permissions

- `activeTab` only — capture is user-initiated on click
- No background scraping

## API

Posts to `/api/captures` with `sourceType: browser_extension`.
