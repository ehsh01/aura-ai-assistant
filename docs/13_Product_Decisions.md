# Recall AI App — Product Decisions Log

## 1. Purpose

This document records important product and architecture decisions.

Decision logs prevent the project from forgetting why choices were made.

## 2. Decision Format

Use this format:

```text
## Decision: [Title]

Date:
Status: proposed / accepted / rejected / replaced

Context:
What problem are we solving?

Decision:
What did we decide?

Rationale:
Why is this the right choice?

Consequences:
What tradeoffs does this create?
```

## 3. Accepted Decisions

## Decision: Recall Is One App With Modules

Status: accepted

Context:
The user has many needs: tasks, finance, tickets, construction, knowledge, documents, and family information.

Decision:
Build one unified app with modular sections instead of separate apps.

Rationale:
One data model allows capture once, use everywhere.

Consequences:
Architecture must be strong enough to support multiple domains without becoming messy.

## Decision: Evidence Is Required For Trust

Status: accepted

Context:
AI answers can be useful but untrustworthy if unsupported.

Decision:
Every important AI answer should support Show Evidence.

Rationale:
The user needs confidence and verification.

Consequences:
Evidence must be designed from the beginning.

## Decision: External Systems Remain Sources of Truth

Status: accepted

Context:
The user already has a finance app, ticketing system, email, Teams, and other tools.

Decision:
Recall will connect to external systems rather than replace all of them.

Rationale:
This reduces complexity and respects official systems.

Consequences:
Connector architecture is critical.

## Decision: Browser Capture Before Microsoft API Integration

Status: accepted

Context:
University Microsoft environments may restrict external app access.

Decision:
Start with browser extension capture instead of relying on Microsoft Graph.

Rationale:
Browser capture is lower friction and more likely to work within restrictions.

Consequences:
Some metadata may be imperfect and require user confirmation.

## 4. Proposed Future Decisions

Potential decisions to evaluate later:

- local AI versus cloud AI
- mobile app timing
- multi-user support
- direct Outlook/Teams API integration
- bidirectional ticket updates
- finance app write-back
- encrypted local-first mode
- vector database selection
