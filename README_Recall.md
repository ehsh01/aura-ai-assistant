# Recall AI App

Recall is an AI-powered Personal Operating System.

**Mission**

> Capture once. Organize automatically. Act with confidence. Verify
> everything.

## Project Philosophy

Recall is the intelligence layer that connects work, personal life,
finance, construction, documents, tickets, email, Teams, and knowledge
into one evidence-backed system.

Recall is **not** intended to replace every application. Instead, it
connects to them through modular connectors while respecting each
application's role as the source of truth.

## Before Writing Code

Every contributor---including AI coding assistants---must read the
documentation in the `/docs` folder.

Recommended reading order:

1.  docs/16_Cursor_Master_Prompt.md
2.  docs/00_Vision.md
3.  docs/02_Cursor_Rules.md
4.  docs/01_Architecture.md
5.  docs/03_Data_Model.md
6.  docs/18_Evidence_Engine.md

## Core Principles

-   Preserve raw source data.
-   Every important AI answer must be backed by evidence.
-   External systems remain the source of truth.
-   Keep capture fast and low friction.
-   Build reusable, modular connectors.
-   Separate business logic from the UI.
-   Allow human correction of AI output.
-   Optimize for long-term maintainability over short-term shortcuts.

## Architecture

See `/docs` for the complete Engineering Playbook.

## Development Workflow

1.  Read the documentation.
2.  Propose a plan.
3.  Implement one logical step.
4.  Update tests.
5.  Update documentation when architecture changes.

## Evernote connector

The Evernote connector is read-only external truth. The default Connect flow
uses Evernote MCP Streamable HTTP with OAuth2 Dynamic Client Registration.
Sync Now incrementally stores changed notes in `source_records`; Ask retrieves
local Postgres evidence and never calls MCP at query time.

Required API environment:

```bash
EVERNOTE_MCP_URL=https://mcp.evernote.com/mcp
EVERNOTE_OAUTH_REDIRECT_URI=https://recall-app.net/api/connectors/evernote/oauth/callback
# Optional fallback-only settings:
# EVERNOTE_EDAM_FALLBACK_ENABLED=true
# EVERNOTE_CONSUMER_KEY=...
# EVERNOTE_CONSUMER_SECRET=...
# EVERNOTE_SANDBOX=false
# EVERNOTE_DEVELOPER_TOKEN=...
```

See `DEPLOYMENT.md` for token sealing, EDAM fallback, pacing, and embedding caps.

Happy building.
