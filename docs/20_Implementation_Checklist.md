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

- [ ] Create Evidence model
- [ ] Link task to source capture
- [ ] Build evidence drawer
- [ ] Add Show Evidence action
- [ ] Test evidence integrity

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
- [ ] Add retry queue
- [ ] Add Outlook collector
- [ ] Add Teams collector

## Connectors

- [ ] Create connector registry
- [ ] Create sync run table
- [ ] Add finance connector
- [ ] Add CSV import
- [ ] Add ticket email parser

## Query

- [ ] Build ask Recall interface
- [ ] Query tasks
- [ ] Query finance
- [ ] Return evidence
- [ ] Show related records

## Hardening

- [ ] Add tests
- [ ] Add backup strategy
- [ ] Add logging
- [ ] Add security review
- [ ] Add documentation update process
