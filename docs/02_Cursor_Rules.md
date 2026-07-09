# Recall AI App — Cursor Rules

## 1. Purpose

This document defines strict rules Cursor must follow when generating, modifying, or refactoring code for the Recall AI App.

Cursor should treat these rules as the engineering constitution of the project.

## 2. Non-Negotiable Rules

### Rule 1: Never Delete Raw Source Data

Raw captures must be preserved.

AI output, normalized records, summaries, and tasks may be updated, but the original source input must remain available for evidence, auditing, reprocessing, and correction.

### Rule 2: Every AI Answer Must Be Traceable

Any AI-generated answer, task, fact, summary, total, recommendation, or classification must be linked to supporting evidence whenever possible.

If evidence is unavailable, the UI and API should clearly indicate that.

### Rule 3: External Systems Remain Sources of Truth

Do not redesign Recall as the owner of data that belongs to another system.

Examples:

- Finance app owns financial transaction truth.
- Ticket system owns official ticket status.
- Email system owns communication history.
- External construction app or export owns original expense rows.

Recall references, indexes, summarizes, and reasons across them.

### Rule 4: Build Modular Connectors

Do not hardcode integration logic directly into UI components or unrelated services.

Every external source should connect through a connector abstraction.

### Rule 5: Keep Capture Lightweight

The browser extension and capture tools should collect context and send it to Recall.

They should not perform deep AI reasoning.

### Rule 6: Preserve Evidence Links

When creating or updating entities, preserve links to:

- source capture
- source record
- source URL
- row number
- message ID
- file name
- timestamp
- original text

### Rule 7: Separate Business Logic From UI

UI components should display and collect data.

Business rules, AI extraction logic, connector sync logic, and evidence mapping should live in services or domain modules.

### Rule 8: Prefer Reusable Domain Services

Before writing new logic, check for existing services.

Examples:

- CaptureService
- EvidenceService
- ConnectorService
- TaskExtractionService
- PersonResolutionService
- ProjectLinkingService

### Rule 9: Manual Correction Must Be Supported

The user must be able to correct AI-generated fields.

Corrections should be saved as user-confirmed values, not overwritten casually by future AI runs.

### Rule 10: Optimize For Trust

When choosing between a fast shortcut and a trustworthy architecture, choose trust.

## 3. Development Behavior Rules

Cursor should:

- read the documentation before making architectural changes
- keep changes small and reviewable
- avoid unrelated refactoring
- explain assumptions in comments or implementation notes
- prefer typed models and validation
- avoid duplicating schema definitions
- include error handling
- include loading and empty states
- add tests for critical logic
- maintain consistent naming

## 4. AI Feature Rules

When building AI features:

- store prompts separately from UI where practical
- version prompts when they become important
- include structured outputs
- validate AI output before saving
- store confidence scores when useful
- preserve original AI response for debugging if appropriate
- never treat AI output as automatically correct
- provide evidence references
- allow human review

## 5. Connector Rules

Every connector should define:

- connector id
- connector type
- source system
- source-of-truth policy
- authentication requirements
- sync method
- normalization method
- evidence mapping
- rate limit handling
- error handling
- retry strategy

## 6. Database Rules

Database changes should:

- preserve existing data
- use migrations
- include indexes for common queries
- avoid storing secrets in plaintext
- use foreign keys where appropriate
- maintain created_at and updated_at timestamps
- support soft deletion where useful
- preserve source references

## 7. UI Rules

The UI should:

- make capture fast
- make evidence easy to inspect
- keep the Today page focused
- avoid overwhelming the user
- show processing states
- allow correction
- show source context
- make uncertainty visible

## 8. Security Rules

Cursor must not:

- expose API keys in frontend code
- log secrets
- store tokens unencrypted
- assume external systems are always available
- bypass authentication
- weaken privacy for convenience

## 9. Final Instruction

Before writing code, Cursor should ask:

1. Does this preserve source data?
2. Does this maintain evidence?
3. Does this respect source-of-truth boundaries?
4. Does this fit the connector architecture?
5. Does this reduce friction for Ernesto?
6. Does this make Recall more trustworthy?

If not, redesign before coding.
