# Recall AI App — Roadmap

## 1. Roadmap Philosophy

Build the foundation before chasing advanced features.

Recall should grow in layers:

1. reliable capture
2. structured data
3. evidence
4. tasks
5. connectors
6. natural language intelligence
7. personal operating system modules

## 2. Phase 1 — Foundation

Goal:

Create the core app structure.

Features:

- manual capture inbox
- raw capture storage
- basic AI extraction
- task creation
- evidence links
- task list
- Today page
- project basics
- person basics

Success criteria:

- user can paste an email or Teams message
- app stores raw text
- AI suggests a task
- user can confirm/edit it
- task links back to original source

## 3. Phase 2 — Evidence Engine

Goal:

Make trust a core feature.

Features:

- evidence table
- evidence drawer
- source preview
- link tasks to evidence
- link AI summaries to evidence
- show evidence button
- evidence-backed answer model

Success criteria:

- any task can show its source
- AI answers can show supporting records
- financial totals can show source rows

## 4. Phase 3 — Browser Extension

Goal:

Capture from browser-based tools.

Features:

- Chrome/Edge extension
- capture selected text
- capture page title and URL
- capture visible text
- supported collectors
- popup confirmation
- retry queue
- Recall API endpoint

Initial collectors:

- generic
- Outlook Web
- Teams Web
- ticketing web page

Success criteria:

- user can capture from Outlook Web
- user can capture from Teams Web
- captures land in Recall Inbox

## 5. Phase 4 — Connectors

Goal:

Connect external systems through standard architecture.

Features:

- connector registry
- connector status page
- finance API connector
- CSV/Excel import
- ticket email parser
- sync logs
- retry handling

Success criteria:

- finance transactions can be queried
- imported construction expenses are searchable
- connector errors are visible

## 6. Phase 5 — AI Query Engine

Goal:

Ask natural language questions across data.

Features:

- ask Recall interface
- query tasks
- query projects
- query finance
- query people
- evidence-backed answers
- related records
- follow-up suggestions

Example questions:

- What needs my attention today?
- How much did I spend on drywall?
- What did Dr. Smith ask me for?
- Show open items related to the new house.

## 7. Phase 6 — Knowledge Vault

Goal:

Turn captured information into reusable knowledge.

Features:

- knowledge items
- procedures
- command library
- troubleshooting notes
- search
- AI summarization
- links to tasks and projects

## 8. Phase 7 — Family & Home Modules

Goal:

Support life management beyond work.

Features:

- family document hub
- home construction dashboard
- contractor/vendor tracking
- expenses by project
- reminders
- important household information

## 9. Phase 8 — Advanced Intelligence

Goal:

Make Recall proactive.

Features:

- daily briefing
- stale task detection
- repeated requester detection
- suggested priorities
- project health summaries
- automated categorization improvements
- user correction learning

## 10. Phase 9 — Hardening

Goal:

Make Recall dependable.

Features:

- tests
- backups
- migrations
- monitoring
- audit logs
- permissions
- encryption
- export tools

## 11. Build Order Recommendation

Recommended first build order:

1. Capture model
2. Inbox UI
3. Task model
4. Evidence model
5. AI extraction service
6. Manual correction UI
7. Today view
8. Browser extension capture endpoint
9. Finance connector
10. Natural language query with evidence

## 12. Features to Avoid Early

Do not build too early:

- complex mobile app
- full Microsoft Graph integration
- bidirectional ticket updates
- advanced automation rules
- complicated dashboard customization
- multi-user enterprise permissions
- too many AI agents

Foundation first.
