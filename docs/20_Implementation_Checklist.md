# Recall AI App — Implementation Checklist

Last verified against the production codebase: 2026-07-12.

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

- [ ] Create AI extraction service
- [ ] Define prompt version
- [ ] Validate structured output
- [ ] Store raw AI output
- [ ] Create suggested tasks
- [ ] Add confidence scores

## Evidence

- [x] Create Evidence model
- [x] Link task to source capture
- [x] Build evidence drawer
- [x] Add Show Evidence action
- [x] Persist Ask evidence across thread reloads
- [x] Prevent repeated connector syncs from adding duplicate evidence
- [x] Test evidence integrity

## Tasks

- [ ] Create Task model
- [ ] Build task list
- [ ] Build task detail
- [ ] Support status changes
- [ ] Support due dates
- [ ] Support priority

## People

- [ ] Create Person model
- [ ] Link tasks to requesters
- [ ] Build person detail page
- [ ] Add duplicate resolution later

## Projects

- [ ] Create Project model
- [ ] Link tasks to projects
- [ ] Build project detail page
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
- [x] Add CSV import
- [ ] Add ticket email parser

## Query

- [x] Build ask Recall interface
- [x] Query tasks
- [x] Query finance
- [x] Return evidence
- [x] Restore evidence when a saved thread is reopened
- [x] Search OCR and extracted note-attachment text
- [x] Show related records

## Hardening

- [ ] Add tests
- [x] Add backup strategy
- [x] Add restore drill (ephemeral Docker Postgres)
- [x] Durable job queue for capture extraction (Postgres + worker)
- [x] Notes Postgres full-text search (tsvector + GIN; includes OCR)
- [x] Life Memory lifecycle (active / superseded / expired / archived)
- [x] Person merge / dedup
- [x] Person + project timeline APIs
- [x] Deep /ready health (DB + job queue)
- [ ] Add logging
- [ ] Add security review
- [ ] Add documentation update process
