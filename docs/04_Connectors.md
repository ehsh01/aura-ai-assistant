# Recall AI App — Connector Architecture

## 1. Purpose

Connectors allow Recall to receive or retrieve information from outside systems.

A connector should not be a one-off integration. It should follow a predictable interface so new sources can be added over time.

## 2. Connector Philosophy

Recall is the intelligence layer, not necessarily the owner of all data.

The connector system should let Recall:

- ingest information
- sync external records
- preserve source references
- normalize records
- map evidence
- support queries
- avoid duplicating source-of-truth responsibilities

## 3. Initial Connector Types

### 3.1 Manual Capture Connector

The simplest connector.

Input:

- pasted text
- optional source label
- optional person
- optional project
- optional tags

Output:

- Capture record

### 3.2 Browser Extension Connector

Captures browser page context.

Payload:

```json
{
  "url": "string",
  "title": "string",
  "hostname": "string",
  "selectedText": "string",
  "visibleText": "string",
  "timestamp": "string",
  "metadata": {}
}
```

The extension should remain lightweight.

Authentication uses a revocable, expiring `capture:create` extension token.
The raw token is returned once and stored only in the extension; Recall stores
its SHA-256 hash. Extension tokens may call raw capture intake only and must
not grant access to notes, Ask, finance, connectors, or account settings.

### 3.3 Finance API Connector

Connects to Ernesto’s existing finance app API.

Responsibilities:

- fetch transactions
- fetch categories
- fetch accounts if appropriate
- fetch vendors/payees
- support date ranges
- support project or tag mapping
- preserve external transaction IDs

Recall should not become the finance ledger.

### 3.4 CSV / Excel Import Connector

Supports exported data.

Use cases:

- construction expenses
- vendor invoices
- ticket reports
- finance exports
- inventory lists

The import flow should include field mapping.

### 3.5 Outlook Web Capture Connector

Because institutional Microsoft APIs may be restricted, version one should focus on browser-based capture.

Captured fields may include:

- sender
- subject
- date
- selected email body
- page URL
- visible text

Do not depend on Microsoft Graph unless explicitly approved.

### 3.6 Teams Web Capture Connector

Teams messages may be captured through browser extension behavior.

Captured fields may include:

- sender if detectable
- timestamp if detectable
- selected message
- visible thread context
- Teams URL
- channel/chat name if detectable

If sender cannot be detected, Recall should ask the user to confirm.

### 3.7 Ticket Email Parser Connector

Ticket emails are important because they already arrive in email.

The parser should extract:

- ticket number
- ticket title
- requester
- brief description
- priority if present
- ticket link if present
- received timestamp

## 4. Standard Connector Interface

Recommended conceptual interface:

```ts
interface RecallConnector {
  id: string;
  name: string;
  type: ConnectorType;
  sourceOfTruth: SourceOfTruthPolicy;

  authenticate(): Promise<ConnectorAuthResult>;
  testConnection(): Promise<ConnectorHealthResult>;
  fetch(options: FetchOptions): Promise<ConnectorFetchResult>;
  normalize(records: unknown[]): Promise<NormalizedSourceRecord[]>;
  mapEvidence(record: NormalizedSourceRecord): EvidenceInput[];
  sync(options: SyncOptions): Promise<SyncResult>;
}
```

## 5. Source-of-Truth Policies

Each connector should define how Recall treats the data.

Possible policies:

### Read-Only External Truth

Recall reads and references external data but does not write back.

Good for:

- finance data
- email captures
- ticket exports

### Bidirectional Sync

Recall can read and write back.

This should be used carefully and only when reliable.

### Capture-Only

Recall receives data, but the external system is not queried again.

Good for:

- pasted text
- browser extension captures
- screenshots

## 6. Connector Sync Strategy

A sync should track:

- connector id
- start time
- end time
- records fetched
- records created
- records updated
- records skipped
- records failed
- error messages

## 7. Deduplication

Connectors must avoid duplicate records.

Deduplication keys:

- connector_id + external_id
- source URL + timestamp + title
- normalized ticket number
- transaction id
- file hash for documents
- email message id if available

## 8. Error Handling

Connector errors should not crash the app.

Use clear states:

- connected
- disconnected
- sync_failed
- authentication_failed
- rate_limited
- partial_success

## 9. Security

Connector credentials must be protected.

Rules:

- never expose secrets in frontend code
- encrypt tokens
- use environment variables
- scope permissions narrowly
- log metadata, not secrets

## 10. Browser Extension Details

The browser extension should support:

- capture current page
- capture selected text
- capture visible text
- detect supported site
- show preview before sending
- retry failed sends
- queue offline captures
- allow user correction later in Recall

Initial files:

```text
/src/collectors/generic.ts
/src/collectors/outlook.ts
/src/collectors/teams.ts
/src/collectors/ticketing.ts
/src/api/recallClient.ts
/src/popup/App.tsx
```

## 11. Finance API Integration Pattern

The finance app should expose endpoints such as:

```text
GET /transactions?startDate=&endDate=
GET /transactions/:id
GET /categories
GET /vendors
GET /summary?groupBy=category
```

Recall should store:

- transaction reference
- source connector id
- evidence mapping
- cached normalized fields if necessary

## 12. Connector Anti-Patterns

Avoid:

- connector logic inside React components
- direct API calls scattered throughout the app
- storing credentials in local storage without protection
- importing external records without external IDs
- creating tasks from connector data without evidence
- hiding connector sync errors

## 13. Homey Pro (OAuth + Flow webhooks)

Athom Web API OAuth for live device status/control (Ask) plus Flow → webhook alerts for important events.

- OAuth + device/flow sync into `source_records` (`homey_device`, `homey_flow`)
- Authenticated webhook `POST /api/webhooks/homey/:connectorId` → `homey_alert`
- Today / Urgency ranks emergencies first; quiet hours filter `info`
- Sample Flows: [`Homey_Flow_Cookbook.md`](./Homey_Flow_Cookbook.md)
