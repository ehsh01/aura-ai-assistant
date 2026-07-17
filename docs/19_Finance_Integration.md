# Recall AI App — Finance Integration Specification

## 1. Purpose

Recall should connect to Ernesto’s existing finance app through its API.

Recall should not replace the finance app.

## 2. Source of Truth

The finance app remains the source of truth for:

- accounts
- transactions
- categories
- payees
- balances
- financial history

Recall may cache normalized records for search and evidence-backed summaries.

## 3. Use Cases

The user should be able to ask:

- How much did I spend on restaurants last month?
- How much have I spent on the new house?
- Show all payments to this contractor.
- What did I spend at Home Depot this year?
- Which transactions are related to construction?
- What is the remaining budget for a project?

## 4. API Expectations

Useful finance API endpoints:

```text
GET /transactions
GET /transactions/:id
GET /categories
GET /payees
GET /accounts
GET /summary
```

## 5. Data Mapping

Transaction fields:

- external id
- date
- amount
- payee
- merchant
- category
- account
- notes
- tags
- project
- source URL if available
- metadata

## 6. Spend integrity

Ask and Connectors “spent” totals exclude transfers and credit-card payments so bank→card payments are not double-counted with card purchases.

Classification prefers MyFamilyBudget `type` / `transferSubtype` / `affectsSpending`, then payee heuristics (e.g. `CHASE CREDIT CRD EPAY`, `Payment to … card ending`, `Payment Thank You`).

Controlled by `FINANCE_EXCLUDE_TRANSFERS` (default on; set `false` to restore sign-only totals).

## 7. Evidence

Every finance answer must be linked to transactions.

For totals, show:

- transaction count
- total amount
- date range
- included rows
- excluded rows if relevant

## 8. Construction Finance

Construction-related expenses may be identified by:

- category
- tag
- vendor
- project
- imported spreadsheet
- user correction

## 9. Safety

Avoid giving high-stakes financial advice.

Recall can summarize and organize finances, but should not act as a financial advisor.

## 10. Future Ideas

- budget tracking
- anomaly detection
- recurring expense detection
- project spending dashboard
- vendor spending history
- invoice-to-transaction matching
