# Recall AI App — Data Model

## 1. Purpose

This document defines the domain model for Recall.

The data model should support:

- raw capture
- AI extraction
- evidence linking
- tasks
- people
- projects
- financial references
- documents
- connector sync
- natural language query
- manual correction

## 2. Design Philosophy

The model should be source-first and evidence-first.

Every derived object should ideally answer:

- Where did this come from?
- Who or what created it?
- When was it captured?
- What evidence supports it?
- Has the user confirmed or corrected it?

## 3. Core Entities

## 3.1 Capture

A Capture is raw incoming information.

Examples:

- pasted email text
- Teams message text
- ticket email
- browser extension payload
- uploaded file
- imported CSV row group
- API sync record
- text message copied manually

Suggested fields:

```text
id
source_type
source_name
source_url
title
raw_text
raw_html
raw_metadata
captured_by
captured_at
processed_status
processing_error
created_at
updated_at
```

Processing status examples:

- pending
- processing
- processed
- failed
- ignored
- archived

## 3.2 Source Record

A Source Record represents a structured item from an external system.

Examples:

- finance transaction
- ticket
- email message
- Teams message
- spreadsheet row
- document page

Suggested fields:

```text
id
connector_id
external_id
record_type
record_title
record_text
record_metadata
source_url
source_created_at
source_updated_at
last_synced_at
created_at
updated_at
```

## 3.3 Task

A Task is an actionable item.

Suggested fields:

```text
id
title
description
status
priority
due_date
start_date
completed_at
requester_person_id
assigned_to_person_id
project_id
ticket_number
source_capture_id
source_record_id
confidence_score
ai_generated
user_confirmed
created_at
updated_at
```

Task statuses:

- inbox
- open
- waiting
- scheduled
- completed
- canceled
- archived

Priority values:

- low
- normal
- high
- urgent

## 3.4 Person

A Person represents a human or organization contact.

Suggested fields:

```text
id
display_name
first_name
last_name
email
phone
organization
department
role
notes
created_at
updated_at
```

People can be:

- coworkers
- doctors
- requesters
- vendors
- contractors
- family members
- internal support contacts

## 3.5 Project

A Project groups related work.

Suggested fields:

```text
id
name
type
description
status
start_date
end_date
owner_person_id
created_at
updated_at
```

Project types:

- work
- home
- finance
- family
- personal
- software
- construction
- knowledge

## 3.6 Evidence

Evidence links claims and entities back to their source.

Suggested fields:

```text
id
entity_type
entity_id
claim_type
source_capture_id
source_record_id
evidence_text
evidence_metadata
file_name
file_id
row_number
page_number
url
created_at
updated_at
```

Claim types:

- task_created_from
- amount_calculated_from
- person_identified_from
- due_date_extracted_from
- summary_based_on
- category_assigned_from
- project_linked_from

## 3.7 Connector

A Connector represents an external source.

Suggested fields:

```text
id
name
type
description
base_url
auth_type
enabled
last_sync_at
sync_status
created_at
updated_at
```

Connector types:

- finance_api
- browser_extension
- csv_import
- outlook_web_capture
- teams_web_capture
- ticket_email
- manual
- document_upload

## 3.8 Document

A Document represents a file known to Recall.

Suggested fields:

```text
id
file_name
file_type
storage_path
source_capture_id
extracted_text
summary
metadata
uploaded_at
created_at
updated_at
```

## 3.9 AI Extraction

An AI Extraction stores structured output from an AI run.

Suggested fields:

```text
id
capture_id
model_name
prompt_version
raw_response
structured_output
confidence_score
status
created_at
updated_at
```

## 3.10 User Correction

A User Correction records human edits to AI output.

Suggested fields:

```text
id
entity_type
entity_id
field_name
old_value
new_value
reason
corrected_by
created_at
```

## 4. Relationship Rules

### Capture to Task

One capture may produce many tasks.

One task may link to one primary capture and multiple evidence records.

### Capture to Person

A capture may mention multiple people.

People should be resolved carefully to avoid duplicates.

### Project to Task

A project can contain many tasks.

A task may belong to one primary project initially, with possible many-to-many expansion later.

### Evidence to Anything

Evidence should be polymorphic or implemented through join tables.

The architecture must allow evidence to support:

- tasks
- AI answers
- summaries
- financial totals
- project status
- person insights

## 5. Financial Data Modeling

Recall should not duplicate the finance app unnecessarily.

If finance data is pulled from Ernesto’s finance API, store:

- external transaction id
- vendor
- amount
- category
- date
- project association
- source URL or API reference
- sync timestamp

Financial totals should always be computed from transaction records or queried from the finance app.

## 6. Evidence-Backed Answer Model

Natural language answers should optionally be stored.

Suggested fields:

```text
id
question
answer
answer_type
confidence_score
generated_at
created_by
```

Then link answer to evidence records through:

```text
answer_id
evidence_id
```

## 7. Important Indexes

Consider indexes on:

- captures.processed_status
- captures.captured_at
- tasks.status
- tasks.due_date
- tasks.priority
- tasks.requester_person_id
- tasks.project_id
- evidence.entity_type + evidence.entity_id
- source_records.connector_id + external_id
- people.email
- projects.name

## 8. Data Model Anti-Patterns

Avoid:

- tasks without source context
- AI summaries without evidence
- storing external data without external IDs
- duplicating finance app data without sync metadata
- hardcoding person names into tasks
- using raw text as the only search strategy
- deleting captures after task creation
