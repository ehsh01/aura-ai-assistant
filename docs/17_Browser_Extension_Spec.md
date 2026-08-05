# Recall AI App — Browser Extension Specification

## 1. Purpose

The browser extension captures context from **Outlook Web** and **Teams Web** into Recall. It is a privacy-restricted collector for accounts that cannot grant Microsoft Graph permissions, plus a manual Capture fallback on those same hosts.

## 2. Guiding Principle

The extension is a collector, not the brain.

It should capture context and send it to Recall. Recall performs normalization, AI extraction, evidence creation, and task generation.

## 3. Core User Flow

1. User is viewing a page in browser.
2. User selects text or leaves page as-is.
3. User clicks Recall extension.
4. Extension shows Capture Current Page or Capture Selection.
5. Extension sends payload to Recall API.
6. Recall stores raw capture.
7. Recall processes capture in background.
8. Item appears in Inbox for review.

### 3.1 Authentication

The user creates a browser-extension token from Recall Connectors and pastes it
into the extension once. The token:

- is scoped to `capture:create`
- expires and can be revoked independently
- is returned once; Recall stores only its SHA-256 hash
- cannot read personal data or call Ask, finance, connector, or account APIs

The web app uses an `HttpOnly` cookie and must never expose its full session
credential for extension setup.

## 4. Captured Data

The extension should capture:

- URL
- page title
- hostname
- selected text
- visible page text
- timestamp
- collector type
- optional detected sender
- optional detected subject
- optional detected thread/channel name

## 5. Collectors

Initial collectors:

- Outlook Web collector (manual + optional automatic)
- Teams Web collector (manual + optional automatic)

Collectors follow a shared extract → fingerprint → submit pipeline. Ticketing and generic web collectors are out of scope while the extension is host-restricted to Outlook and Teams.

## 6. Privacy

The extension must not monitor arbitrary browsing and must not take screenshots.

**Manual capture** is user-initiated on approved Outlook Web and Teams Web hosts.

**Automatic capture** is optional and **defaults to off**. When the user enables it:

- content scripts run only on Outlook Web and Teams Web
- capture is limited to content that becomes visible after the user opens an email or Teams conversation
- the extension must not open messages, mark items read, alter Microsoft UI, or scrape inboxes in bulk
- captures are sent as Recall review items; AI extraction stays on the server

Silent bulk scraping of mailboxes or chats is not allowed.

## 7. Retry Queue

If Recall API is unavailable:

- store capture temporarily in extension storage
- show failed status
- allow retry
- avoid losing capture

## 8. Manifest Permissions

Use minimal permissions.

Avoid requesting broad permissions unless necessary.

## 9. Future Features

- right-click capture
- keyboard shortcut
- capture screenshot
- sender detection improvements
- ticket number detection
- source preview
