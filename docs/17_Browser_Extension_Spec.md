# Recall AI App — Browser Extension Specification

## 1. Purpose

The browser extension allows low-friction capture from web-based tools such as Outlook Web, Teams Web, ticketing systems, and general web pages.

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

- generic collector
- Outlook Web collector
- Teams Web collector
- ticketing collector

Collectors should follow a shared interface.

## 6. Privacy

The extension should not silently scrape pages.

Capture should be user-initiated.

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
