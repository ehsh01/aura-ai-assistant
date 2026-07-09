# Recall AI App — UI/UX Principles

## 1. Design Goal

Recall should feel calm, fast, trustworthy, and useful.

The user should feel:

- less overwhelmed
- more in control
- confident in what needs attention
- able to verify any AI claim
- able to capture without friction

## 2. Core UI Principles

### 2.1 Inbox Is Sacred

The Inbox is where raw life enters the system.

It should be simple, fast, and forgiving.

The Inbox should show:

- captured source
- summary
- suggested task
- suggested project
- suggested person
- confidence
- processing status
- review actions

### 2.2 Today Must Not Overwhelm

The Today page should answer:

> What deserves my attention today?

It should not become a cluttered dashboard of everything.

Recommended sections:

- Must Do Today
- Waiting on Someone
- Recently Captured
- Follow-Ups
- Suggested Focus
- Overdue

### 2.3 Evidence Should Be One Click Away

Every AI answer should have a Show Evidence option.

Evidence display should include:

- original source text
- source system
- timestamp
- related records
- file or row reference
- link to source when available

### 2.4 Capture Should Take 1–2 Actions

Preferred flows:

- paste and submit
- click browser extension
- select text and capture
- upload file
- import CSV
- sync connector

Avoid long forms during capture.

### 2.5 Review Later, Not During Capture

The capture moment should be fast.

Detailed review can happen later in Inbox.

## 3. Key Screens

## 3.1 Home / Today

Purpose:

- help user focus

Elements:

- top priority items
- overdue items
- upcoming due dates
- recent important captures
- AI focus summary

## 3.2 Inbox

Purpose:

- process captured items

Actions:

- create task
- link to project
- assign person
- archive
- mark not actionable
- edit AI extraction
- show evidence

## 3.3 Task Detail

Show:

- task title
- status
- due date
- requester
- project
- source
- evidence
- related captures
- notes
- activity history

## 3.4 Person Detail

Show:

- contact info
- open tasks
- completed tasks
- related tickets
- related projects
- recent messages
- notes

## 3.5 Project Detail

Show:

- project summary
- open tasks
- related people
- related captures
- documents
- financial summaries if applicable
- evidence-backed status

## 3.6 Finance View

Show:

- summaries
- category totals
- vendor totals
- project-related expenses
- date filters
- evidence rows

## 3.7 Evidence Drawer

A reusable UI component.

Should support:

- source preview
- highlighted evidence text
- related records
- link to source
- row/file details
- confidence info

## 4. Interaction Patterns

### 4.1 AI Suggestion Cards

AI suggestions should be shown as editable cards.

Actions:

- accept
- edit
- reject
- link
- defer

### 4.2 Confidence Indicators

Do not overcomplicate with too many scores.

Use simple labels:

- High confidence
- Needs review
- Uncertain

### 4.3 Progressive Disclosure

Keep screens simple.

Show advanced information only when requested.

## 5. Tone

Recall should sound:

- clear
- practical
- calm
- concise
- not overly cheerful
- not robotic

Example:

Good:

> I found 3 possible follow-ups from this email.

Bad:

> Amazing! I have brilliantly discovered tasks for you!

## 6. Accessibility

Use:

- readable fonts
- clear contrast
- keyboard navigation
- semantic HTML
- useful empty states
- clear focus states

## 7. Empty States

Empty states should guide action.

Example:

> No captures yet. Paste an email, use the browser extension, or import a file to get started.

## 8. UI Anti-Patterns

Avoid:

- dashboards with too many widgets
- hidden AI logic
- making users fill long forms
- showing raw JSON
- creating multiple places to do the same thing
- burying evidence
- making capture slower than copy/paste
