# Recall AI App — Evidence Engine

## 1. Purpose

The Evidence Engine is one of Recall’s most important systems.

It ensures that AI-generated answers, tasks, summaries, and calculations can be verified.

## 2. Why Evidence Matters

AI tools are useful but can be wrong.

Recall must earn trust by showing where answers come from.

## 3. Evidence Examples

For a task:

- original message text
- sender
- timestamp
- source URL

For a financial answer:

- transaction rows
- vendor
- amount
- date
- external transaction id

For a project summary:

- related tasks
- documents
- notes
- transactions
- messages

## 4. Evidence UI

Every evidence-backed item should support:

- Show Evidence button
- evidence drawer
- source preview
- highlighted text
- related records

## 5. Evidence Data Requirements

Evidence records should include:

- entity type
- entity id
- claim type
- source capture id
- source record id
- evidence text
- metadata
- source URL
- file/row/page reference

## 6. Evidence and AI Answers

When answering questions, Recall should return:

- answer text
- evidence references
- confidence
- caveats

## 7. Evidence and Financial Totals

Financial totals must be computed from records.

The UI should allow the user to click the total and see transaction rows.

## 8. Evidence Anti-Patterns

Avoid:

- summaries without source
- totals without rows
- tasks without capture links
- evidence hidden deep in UI
- source text overwritten by AI output

## 9. Implemented Durability Rules

- Ask stores the exact evidence excerpts, source metadata, privacy details,
  confidence, caveats, and prompt version with each assistant message.
- Reopening an Ask thread restores the evidence used for that answer instead of
  rebuilding it from records that may have changed.
- Connector sync updates the current evidence for a source-record claim rather
  than appending another copy on every sync.
- Legacy duplicate connector evidence is collapsed when displayed.
- Finance totals shown by Ask, Home, and Connectors use the synced
  `source_records` snapshot and expose the period used for the calculation.
- Note text used by Ask includes the full searchable note body plus capped OCR
  and extracted text from attached images, PDFs, and documents.
