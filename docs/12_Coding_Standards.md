# Recall AI App — Coding Standards

## 1. Purpose

This document defines coding standards for Recall.

The goal is to keep the codebase readable, maintainable, modular, and easy for Cursor to extend correctly.

## 2. General Principles

- clarity over cleverness
- strong typing
- small functions
- modular services
- consistent naming
- explicit error handling
- reusable components
- no hidden business logic in UI
- test critical paths

## 3. TypeScript Standards

Use TypeScript types for:

- API requests
- API responses
- database models
- connector payloads
- AI structured outputs
- UI props
- service inputs and outputs

Avoid using `any` unless absolutely necessary.

## 4. Suggested Folder Structure

Example:

```text
/src
  /app
  /components
  /features
    /captures
    /tasks
    /evidence
    /people
    /projects
    /connectors
    /finance
    /ai
  /services
  /lib
  /db
  /types
  /utils
  /prompts
  /tests
/docs
```

## 5. Service Layer

Business logic should live in services.

Examples:

```text
CaptureService
TaskService
EvidenceService
ConnectorService
AIExtractionService
FinanceQueryService
PersonResolutionService
ProjectLinkingService
```

## 6. Component Standards

Components should:

- receive typed props
- avoid direct database access
- avoid business logic
- handle loading states
- handle empty states
- handle errors
- be reusable where practical

## 7. Naming

Use clear names.

Good:

```text
createCaptureFromBrowserPayload
linkTaskToEvidence
normalizeFinanceTransaction
extractTasksFromCapture
```

Bad:

```text
doStuff
handleData
processThing
magicAI
```

## 8. Error Handling

Errors should be:

- caught at boundaries
- logged safely
- shown clearly to users
- represented in API responses consistently

## 9. Comments

Comment why, not what.

Good comments explain:

- business rules
- source-of-truth decisions
- evidence mapping logic
- unusual connector behavior
- AI prompt assumptions

## 10. AI Prompt Files

Store important prompts in a clear location:

```text
/src/prompts/taskExtraction.v1.ts
/src/prompts/queryAnswer.v1.ts
```

Prompts should include:

- purpose
- expected output schema
- version
- examples if useful

## 11. Validation

Use schema validation for:

- API input
- connector payloads
- AI output
- import files
- form submissions

## 12. Refactoring Rules

When refactoring:

- preserve behavior
- preserve evidence links
- run tests
- avoid unrelated rewrites
- update docs if architecture changes

## 13. Anti-Patterns

Avoid:

- giant files
- duplicated connector logic
- AI prompts embedded inside UI components
- database calls inside random components
- untyped API responses
- silent catch blocks
- hardcoded user-specific values
- magic strings without constants
