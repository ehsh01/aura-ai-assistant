# Recall AI App — API Standards

## 1. Purpose

This document defines API conventions for Recall.

APIs should be consistent, predictable, secure, and easy for Cursor to extend.

## 2. General Standards

Use:

- JSON request and response bodies
- consistent error format
- versioned endpoints when needed
- server-side validation
- typed request/response models
- clear status codes

## 3. Response Format

Recommended success format:

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

Recommended error format:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "A user-friendly error message",
    "details": {}
  }
}
```

## 4. Authentication

APIs should not assume public access.

Use authenticated sessions or API tokens depending on endpoint type.

Browser extension endpoints may use:

- user session token
- extension token
- short-lived API token
- local development token

Secrets must not be hardcoded.

## 5. Capture API

Endpoint:

```text
POST /api/captures
```

Request:

```json
{
  "sourceType": "browser_extension",
  "sourceName": "Outlook Web",
  "sourceUrl": "https://...",
  "title": "Email subject",
  "rawText": "Captured text",
  "metadata": {}
}
```

Response:

```json
{
  "success": true,
  "data": {
    "captureId": "cap_123",
    "status": "pending"
  }
}
```

## 6. Task API

Suggested endpoints:

```text
GET /api/tasks
POST /api/tasks
GET /api/tasks/:id
PATCH /api/tasks/:id
POST /api/tasks/:id/complete
GET /api/tasks/:id/evidence
```

## 7. Evidence API

Suggested endpoints:

```text
GET /api/evidence/:id
GET /api/entities/:entityType/:entityId/evidence
POST /api/evidence
```

## 8. Connector API

Suggested endpoints:

```text
GET /api/connectors
POST /api/connectors
GET /api/connectors/:id
PATCH /api/connectors/:id
POST /api/connectors/:id/test
POST /api/connectors/:id/sync
GET /api/connectors/:id/sync-runs
```

## 9. Finance Query API

Recall may expose its own query layer:

```text
GET /api/finance/transactions
GET /api/finance/summary
GET /api/finance/vendors/:id
```

But the finance connector should still respect the external finance app as source of truth.

## 10. AI API

Suggested endpoints:

```text
POST /api/ai/extract
POST /api/ai/query
GET /api/ai/runs/:id
```

AI extraction should usually be triggered by background jobs, not direct UI blocking calls.

## 11. Pagination

Use cursor-based pagination where possible.

Example:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "nextCursor": "abc123"
  }
}
```

## 12. Validation

All incoming API payloads should be validated.

Recommended:

- Zod or equivalent schema validation
- typed DTOs
- clear validation errors

## 13. Error Codes

Common error codes:

- VALIDATION_ERROR
- UNAUTHORIZED
- FORBIDDEN
- NOT_FOUND
- CONFLICT
- RATE_LIMITED
- CONNECTOR_ERROR
- AI_EXTRACTION_FAILED
- INTERNAL_ERROR

## 14. API Anti-Patterns

Avoid:

- inconsistent response formats
- raw database objects leaking to clients
- unvalidated AI output
- returning secrets
- exposing stack traces
- using API endpoints for unrelated business logic
- blocking UI on slow connector syncs
