# Recall AI App — Implementation Checklist

## Foundation

- [ ] Create `/docs` folder
- [ ] Add engineering playbook files
- [ ] Confirm project stack
- [ ] Define environment variables
- [ ] Set up database migrations
- [ ] Create core models

## Capture

- [ ] Create Capture model
- [ ] Build manual paste capture UI
- [ ] Create capture API endpoint
- [ ] Store raw text
- [ ] Track processing status

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

- [ ] Create extension project
- [ ] Capture selected text
- [ ] Capture page URL/title
- [ ] Post to Recall API
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
