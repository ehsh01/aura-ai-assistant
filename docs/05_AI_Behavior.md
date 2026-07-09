# Recall AI App — AI Behavior Specification

## 1. Purpose

This document defines how AI should behave inside Recall.

AI is not decoration. It is a reasoning and extraction layer that turns raw information into useful, verifiable structure.

## 2. AI Responsibilities

AI may help with:

- task extraction
- summarization
- person identification
- project linking
- due date detection
- priority estimation
- follow-up detection
- financial categorization suggestions
- document summarization
- natural language query answering
- evidence explanation
- duplicate detection
- next-action suggestions

## 3. AI Must Not

AI must not:

- fabricate source details
- invent people
- invent transactions
- silently overwrite user corrections
- delete source captures
- produce financial totals without evidence
- imply certainty when uncertain
- make external system changes without explicit user action
- hide ambiguity

## 4. Extraction Philosophy

AI extraction should be conservative and evidence-backed.

When extracting a task, AI should identify:

- what needs to be done
- who requested it
- who owns it
- when it is due
- source text
- confidence
- whether human review is needed

## 5. Task Extraction Rules

A task should be created when the capture contains an action or obligation.

Examples:

- “Please install software on my computer.”
- “Can you check this ticket?”
- “Follow up with Dr. Smith.”
- “Need access to shared folder.”
- “Please call me when you can.”

Do not create tasks for purely informational messages unless follow-up is implied.

## 6. Due Date Rules

AI may extract due dates from phrases such as:

- today
- tomorrow
- next week
- by Friday
- before the meeting
- ASAP
- end of day

If a relative date is found, store the resolved date and the original phrase as evidence.

If no due date is clear, leave it blank or suggest one with low confidence.

## 7. Priority Rules

Priority should be estimated based on:

- urgency language
- sender role
- ticket severity
- due date
- impact
- repeated follow-ups
- explicit priority labels

AI should not overuse urgent priority.

## 8. Person Resolution

AI may detect people from:

- email sender
- message text
- Teams display name
- signature
- ticket requester
- manually entered requester

If multiple possible people match, ask for confirmation or mark low confidence.

## 9. Project Linking

AI may suggest a project based on:

- source connector
- keywords
- people involved
- ticket category
- finance category
- user history
- explicit project names

Project assignments should be editable.

## 10. Evidence Requirement

For each extracted item, AI should provide evidence references.

Example structured output:

```json
{
  "tasks": [
    {
      "title": "Install requested software for Dr. Smith",
      "requester": "Dr. Smith",
      "dueDate": null,
      "priority": "normal",
      "confidence": 0.82,
      "evidenceText": "Can you install the software on my computer?"
    }
  ]
}
```

## 11. Natural Language Answers

When the user asks a question, Recall should answer with:

1. direct answer
2. supporting evidence
3. confidence or caveats when needed
4. related records
5. optional suggested next action

Example:

> You spent $8,573 on drywall across 4 transactions. The largest payment was $4,200 to ABC Drywall on May 12. Show Evidence.

## 12. Financial AI Rules

Financial answers must be based on transactions, not guesses.

AI may categorize or summarize, but calculations should be deterministic whenever possible.

For totals:

- query transactions
- compute exact sum
- show rows
- link to source records

## 13. Prompt Versioning

Important prompts should be versioned.

Prompt records should include:

- prompt name
- version
- purpose
- expected JSON schema
- created date
- notes

## 14. Structured Output

Prefer structured JSON output for AI extraction.

Validate output before saving.

If validation fails:

- store raw AI response
- mark extraction failed
- allow retry

## 15. Confidence Scores

Use confidence scores for:

- task extraction
- person matching
- due date interpretation
- project assignment
- category suggestion
- duplicate detection

Low-confidence items should go to review.

## 16. Human Review

AI-generated items should have states such as:

- suggested
- confirmed
- corrected
- rejected

## 17. AI Anti-Patterns

Avoid:

- treating chat as the only interface
- saving unvalidated AI JSON
- creating tasks without source text
- giving financial answers without rows
- hiding uncertainty
- overriding user corrections
- using AI for deterministic math when code should compute it
