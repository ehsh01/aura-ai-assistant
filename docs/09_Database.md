# Recall AI App — Database Design

## 1. Purpose

This document defines database design principles for Recall.

The database must support:

- raw capture preservation
- task management
- evidence links
- connector sync
- AI extraction
- search
- financial references
- project/person relationships
- future scalability

## 2. Recommended Database

Use PostgreSQL unless the project has already chosen another database.

PostgreSQL is a strong fit because it supports:

- relational integrity
- JSONB metadata
- full-text search
- indexing
- migrations
- transactions
- extensions
- future vector support if needed

## 3. Core Tables

Recommended initial tables:

```text
captures
source_records
tasks
people
projects
evidence
connectors
documents
ai_extractions
user_corrections
sync_runs
```

## 4. captures

Stores raw input.

Important columns:

```text
id primary key
source_type text
source_name text
source_url text
title text
raw_text text
raw_html text
raw_metadata jsonb
processed_status text
processing_error text
captured_at timestamptz
created_at timestamptz
updated_at timestamptz
```

Indexes:

```text
processed_status
captured_at
source_type
```

## 5. source_records

Stores normalized external records.

Important columns:

```text
id
connector_id
external_id
record_type
record_title
record_text
record_metadata jsonb
source_url
source_created_at
source_updated_at
last_synced_at
created_at
updated_at
```

Unique constraint:

```text
connector_id + external_id
```

## 6. tasks

Important columns:

```text
id
title
description
status
priority
due_date
completed_at
requester_person_id
assigned_to_person_id
project_id
ticket_number
source_capture_id
source_record_id
confidence_score
ai_generated boolean
user_confirmed boolean
created_at
updated_at
```

Indexes:

```text
status
due_date
priority
project_id
requester_person_id
ticket_number
```

## 7. evidence

Important columns:

```text
id
entity_type
entity_id
claim_type
source_capture_id
source_record_id
evidence_text
evidence_metadata jsonb
file_name
file_id
row_number
page_number
url
created_at
updated_at
```

Indexes:

```text
entity_type + entity_id
source_capture_id
source_record_id
claim_type
```

## 8. people

Important columns:

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

Indexes:

```text
email
display_name
organization
```

## 9. projects

Important columns:

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

Indexes:

```text
name
type
status
```

## 10. connectors

Important columns:

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
settings jsonb
created_at
updated_at
```

Secrets should not be stored directly in connector settings unless encrypted.

## 11. sync_runs

Tracks connector sync history.

Important columns:

```text
id
connector_id
status
started_at
completed_at
records_fetched
records_created
records_updated
records_failed
error_message
metadata jsonb
```

## 12. ai_extractions

Stores AI processing results.

Important columns:

```text
id
capture_id
model_name
prompt_version
raw_response
structured_output jsonb
confidence_score
status
error_message
created_at
updated_at
```

## 13. user_corrections

Stores human correction history.

Important columns:

```text
id
entity_type
entity_id
field_name
old_value
new_value
reason
created_at
```

## 14. Deletion Strategy

Prefer soft deletion for important entities.

Never hard-delete raw captures by default.

Consider hard deletion only for:

- user-requested privacy deletion
- test data cleanup
- clearly temporary data

## 15. Search Strategy

Initial search:

- database text search
- filters
- relationships

Future search:

- embeddings
- semantic search
- hybrid search

## 16. Migration Rules

Migrations should be:

- reversible when practical
- reviewed
- tested on sample data
- designed to preserve existing records

## 17. Database Anti-Patterns

Avoid:

- storing everything as JSON only
- no indexes on task status/due date
- deleting source data after processing
- no sync history
- no correction history
- putting secrets in plaintext
- creating evidence as plain text only without relationships
