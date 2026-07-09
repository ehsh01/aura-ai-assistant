# Recall AI App — Testing Strategy

## 1. Purpose

Testing ensures Recall remains trustworthy as features grow.

Because Recall uses AI, connectors, and evidence-based answers, testing must cover both deterministic and probabilistic behavior.

## 2. Test Categories

- unit tests
- integration tests
- API tests
- database tests
- connector tests
- AI extraction tests
- UI tests
- evidence integrity tests
- regression tests

## 3. Unit Tests

Unit tests should cover:

- task status transitions
- date parsing helpers
- evidence mapping
- connector normalization
- financial calculations
- validation schemas
- person matching logic
- project linking helpers

## 4. Integration Tests

Integration tests should cover flows such as:

- create capture
- process capture
- extract task
- create evidence
- show task with source
- import CSV
- sync connector
- query finance summary

## 5. Evidence Integrity Tests

Critical tests:

- every AI-created task has a source capture or evidence record
- financial totals link to transaction evidence
- deleting a task does not delete raw capture
- evidence drawer can load source text
- user correction preserves history

## 6. AI Extraction Tests

Use representative samples:

- ticket email
- Outlook request
- Teams request
- vague message
- non-actionable message
- construction expense row
- finance transaction
- multi-task email

Expected checks:

- correct task count
- no task for non-actionable message
- requester extracted when present
- due date extracted when clear
- confidence low when ambiguous
- evidence text included

## 7. AI Regression Dataset

Maintain a folder:

```text
/tests/fixtures/ai/
```

Include anonymized examples.

Each fixture should have:

- input text
- expected structured output
- notes

## 8. Connector Tests

For each connector:

- authentication failure
- fetch success
- empty result
- duplicate record
- partial failure
- normalization
- evidence mapping

## 9. API Tests

Test:

- success responses
- validation errors
- unauthorized access
- not found
- connector error
- AI processing failure

## 10. UI Tests

Important UI flows:

- paste capture
- review AI suggestion
- create task
- edit task
- show evidence
- complete task
- filter Today view
- import file

## 11. Manual QA Checklist

Before major release:

- capture works
- raw source preserved
- AI extraction works
- evidence visible
- Today page useful
- connector sync visible
- no secrets exposed
- errors are understandable

## 12. Testing Anti-Patterns

Avoid:

- testing only happy paths
- no tests around evidence
- no AI regression examples
- no connector failure tests
- relying only on manual testing
- treating AI output as deterministic without validation
