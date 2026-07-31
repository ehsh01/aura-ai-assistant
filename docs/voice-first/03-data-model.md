# Voice First — Data Model

**Date:** 2026-07-31  
**Milestone:** 5

## Reused entities

| Concept | Table / service |
|---------|-----------------|
| Capture | `captures` |
| Conversation | `ask_threads` / `ask_messages` |
| Task / reminder | `tasks` / `attention_items` |
| People / projects | `people` / `projects` + `entity_links` |
| Jobs | `jobs` |
| Cost telemetry | `ai_usage` |

## New: `action_proposals`

Durable proposals so confirm / correct / cancel are server-authoritative.

| Column | Purpose |
|--------|---------|
| `id` | `aprop-…` |
| `user_id` | Tenant scope |
| `thread_id` / `capture_id` | Conversation + provenance |
| `action_type` / `draft` / `explanation` | What will execute |
| `status` | `proposed` → `confirmed` → `executed` (or `cancelled` / `superseded` / `failed`) |
| `version` / `supersedes_id` | Correction history |
| `idempotency_key` | Deduped re-plan |
| `executed_entity_*` | Idempotent confirm replay |

## Attachment `content_hash`

SHA-256 of file bytes on `note_attachments` so identical images for the same user are not OCR’d twice.
