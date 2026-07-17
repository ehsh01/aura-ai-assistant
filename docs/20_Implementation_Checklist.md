# Recall AI App — Implementation Checklist

Last verified against the production codebase: 2026-07-17.

## Foundation

- [x] Create `/docs` folder
- [x] Add engineering playbook files
- [x] Confirm project stack
- [x] Define environment variables
- [x] Set up database migrations
- [x] Create core models

## Capture

- [x] Create Capture model
- [x] Build manual paste capture UI
- [x] Create capture API endpoint
- [x] Store raw text before processing
- [x] Track processing status

## AI Extraction

- [x] Create AI extraction service
- [x] Define prompt version
- [x] Validate structured output
- [x] Store raw AI output
- [x] Create suggested tasks
- [x] Add confidence scores

## Evidence

- [x] Create Evidence model
- [x] Link task to source capture
- [x] Build evidence drawer
- [x] Add Show Evidence action
- [x] Persist Ask evidence across thread reloads
- [x] Prevent repeated connector syncs from adding duplicate evidence
- [x] Test evidence integrity

## Tasks

- [x] Create Task model
- [x] Build task list
- [x] Build task detail
- [x] Support status changes
- [x] Support due dates
- [x] Support priority

## People

- [x] Create Person model
- [x] Link tasks to requesters
- [x] Build person detail page
- [x] Add duplicate resolution later

## Projects

- [x] Create Project model
- [x] Link tasks to projects
- [x] Build project detail page
- [x] Include projects in Ask retrieval corpus
- [ ] Add project summaries later

## Browser Extension

- [x] Create extension project
- [x] Capture selected text
- [x] Capture page URL/title
- [x] Post to Recall API with a scoped, revocable capture token
- [x] Add retry queue
- [ ] Add Outlook collector
- [ ] Add Teams collector

## Connectors

- [x] Create connector registry
- [x] Create sync run table
- [x] Add finance connector
- [x] Use one synced finance snapshot across Ask, Home, and Connectors
- [x] Exclude transfers / credit-card payments from “spent” (`FINANCE_EXCLUDE_TRANSFERS`)
- [x] Add CSV import
- [x] Add Homey connector (OAuth + webhooks)
- [x] Add Google multi-mailbox sync
- [x] Add Microsoft Outlook / Teams sync
- [ ] Add ticket email parser

## Query

- [x] Build ask Recall interface
- [x] Query tasks
- [x] Query finance
- [x] Return evidence
- [x] Restore evidence when a saved thread is reopened
- [x] Search OCR and extracted note-attachment text
- [x] Show related records
- [x] Retrieve projects alongside notes/people/assets

## Hardening

- [x] Add tests (Vitest API suite + Playwright smoke)
- [x] Add backup strategy
- [x] Add restore drill (ephemeral Docker Postgres)
- [x] Durable job queue for capture extraction (Postgres + worker)
- [x] Notes Postgres full-text search (tsvector + GIN; includes OCR)
- [x] Life Memory lifecycle (active / superseded / expired / archived)
- [x] Person merge / dedup
- [x] Person + project timeline APIs
- [x] Deep /ready health (DB + job queue)
- [x] Add structured logging
- [ ] Add security review
- [ ] Add documentation update process

## Life OS roadmap

- [x] Subject timeline across mail / transactions / docs (project / home / vehicle)
- [x] Receipt ↔ transaction matching (suggest + confirm)
- [x] Subscription heuristics (Connectors)
- [x] Gmail waiting-on follow-ups
- [x] In-app weekly digest (Today)
- [x] Ask answer feedback → corrections
- [x] User rules for Ask (Settings)
- [ ] Outbound digests / email notifications
- [ ] Calendar-first UX + deadline extraction
