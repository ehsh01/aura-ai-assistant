# Recall AI App — System Architecture

## 1. Architectural Overview

Recall should be designed as a modular intelligence platform.

The application has six major layers:

1. Capture Layer
2. Normalization Layer
3. AI Extraction Layer
4. Evidence Layer
5. Query & Reasoning Layer
6. User Interface Layer

These layers should be independent enough to evolve separately while sharing a consistent data model.

## 2. Architecture Principles

### 2.1 Capture First, Interpret Later

Raw input must be stored before AI processing.

This is critical because:

- AI extraction may improve later.
- The user may need to verify the original source.
- Mistakes can be corrected without losing the original input.
- New entity types can be extracted from old captures later.

### 2.2 Evidence Is a First-Class System

Evidence should not be an afterthought.

Every important object should be able to reference:

- source capture
- source URL
- source text
- file
- row number
- message
- ticket
- transaction
- API record
- timestamp

The evidence system should be reusable across tasks, finance, tickets, documents, and AI answers.

### 2.3 Connectors Are Modular

External data sources should be connected through a standard connector interface.

Each connector should define:

- source type
- authentication
- fetch method
- normalization method
- sync strategy
- evidence mapping
- error handling
- source-of-truth rules

### 2.4 UI Is a View Over Connected Data

The UI should not create isolated storage patterns per module.

For example:

- The Tasks page displays task records.
- The Person page displays people plus related captures, tasks, tickets, and projects.
- The Finance page displays financial summaries plus evidence records.
- The Today page displays prioritized items from across the system.

## 3. High-Level Data Flow

```text
Input Source
    ↓
Capture Layer
    ↓
Raw Capture Stored
    ↓
Normalization Layer
    ↓
Structured Source Records
    ↓
AI Extraction Layer
    ↓
Tasks / People / Projects / Facts / Categories
    ↓
Evidence Layer
    ↓
Verifiable Links
    ↓
Query + UI Layer
    ↓
Actionable, explainable user experience
```

## 4. Main Modules

### 4.1 Inbox

The Inbox is the universal intake area.

Every new capture should be visible here until it is processed, dismissed, linked, converted, or archived.

The Inbox should support:

- raw capture preview
- AI summary
- suggested tasks
- suggested people
- suggested projects
- confidence indicators
- manual correction
- evidence preview

### 4.2 Today

The Today view shows what needs attention now.

It should include:

- due tasks
- overdue tasks
- follow-ups
- high-priority captures
- waiting items
- recently updated projects
- reminders
- AI-suggested focus items

### 4.3 Tasks

Tasks are actionable units.

Tasks may originate from:

- emails
- Teams messages
- tickets
- pasted notes
- documents
- imported rows
- manual entry
- API connectors

A task must link back to its evidence whenever possible.

### 4.4 People

People represent requesters, vendors, family members, coworkers, contractors, and contacts.

A person page should show:

- related tasks
- related messages
- related tickets
- related projects
- notes
- contact info
- recent interactions
- open follow-ups

### 4.5 Projects

Projects group related work or life efforts.

Examples:

- Psychiatry IT Support
- New House Construction
- Home Finance Review
- Family Documents
- Recall App Development

### 4.6 Knowledge

Knowledge stores reusable information:

- how-to notes
- commands
- procedures
- vendor details
- troubleshooting steps
- lessons learned
- configuration notes

Knowledge may be manually entered or extracted from captures.

### 4.7 Finance

The Finance module should not replace the existing finance app.

Instead, Recall should query the finance API or import financial exports, then provide:

- summaries
- category breakdowns
- construction-related expenses
- vendor totals
- time-based reports
- evidence-backed totals

### 4.8 Documents

The Documents module stores metadata, extracted text, summaries, and relationships.

Document storage should maintain:

- original filename
- upload date
- source
- extracted text
- related entities
- evidence anchors

### 4.9 Connectors

Connectors allow external systems to feed Recall.

Initial connectors:

- Manual Capture
- Browser Extension
- Finance API
- CSV/Excel Import
- Outlook Web Capture
- Teams Web Capture
- Ticket Email Parser

## 5. Recommended Technical Stack

Cursor should adapt to the actual project stack, but the architecture assumes:

- TypeScript
- React or Next.js
- Node.js backend or Next.js API routes
- PostgreSQL
- Prisma or another ORM
- Vector database support if semantic search is needed
- Background job processing for sync and AI extraction
- Structured logging
- Environment-based configuration

## 6. Background Processing

AI extraction and connector syncs should not block the UI.

Use background jobs for:

- AI extraction
- document parsing
- connector sync
- evidence indexing
- vector embedding
- retrying failed captures
- financial import processing

Job records should track:

- status
- attempts
- error message
- started_at
- completed_at
- related entity

## 7. Failure Handling

Recall must handle partial failure gracefully.

Examples:

- Capture succeeds but AI processing fails.
- Connector sync partially imports records.
- Finance API is temporarily unavailable.
- Browser extension submits duplicate capture.
- AI extraction returns low confidence.

In all cases:

- preserve raw input
- show processing status
- allow retry
- avoid data loss
- log useful diagnostics

## 8. Architecture Anti-Patterns

Avoid:

- storing tasks without source references
- letting AI overwrite raw data
- hardcoding finance/ticket/email logic throughout the app
- building separate data models per module
- making the browser extension too smart
- hiding confidence and uncertainty
- designing chat as the only interface
- creating answers without evidence
