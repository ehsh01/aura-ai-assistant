# Voice First — Implementation Log

## Milestone 1 — Assessment (2026-07-30)

### Goal

Inspect Recall, run baseline checks, and produce architecture docs **without** implementing Voice First code.

### Changes made

- Created `docs/voice-first/` documentation set (assessment only).
- No application code, schema, or dependency changes in M1.

### Files changed / added (M1)

| File | Action |
|------|--------|
| `docs/voice-first/01-current-state.md` | Added |
| `docs/voice-first/02-architecture.md` | Added |
| `docs/voice-first/08-implementation-log.md` | Added |

### Migrations

None.

### Architectural decisions

1. **Voice First is a boundary, not a rewrite.** Prefer adapters under `services/voice-first/` that call existing domain services.
2. **Do not duplicate** tasks, reminders, captures, threads, or entity links.
3. **Reminders map to `attention_items`** via existing `create_reminder` → `upsertAttentionItemForUser`.
4. **Conversation sessions map to `ask_threads`**, not a new sessions table (unless proven insufficient).
5. **Only likely net-new durable store:** `action_proposals` (or equivalent) — deferred to Milestone 5.
6. **STT:** browser Web Speech when available; **MediaRecorder + server Whisper** when blocked (iOS PWA) or unsupported.
7. **Person/project linking on Ask confirm** remains the highest-leverage gap for the reminder vertical slice (extraction already exists).

### Product decisions (2026-07-30)

| Decision | Choice |
|----------|--------|
| “Tomorrow morning” fallback | **09:00** in user timezone |
| Confirm UX (v1) | **Tap-to-confirm** for all creates |
| STT / PWA mic | **MediaRecorder + server STT** so iOS home-screen PWA can use the mic |
| Talk surface | **Both** Today and Ask |

### Assumptions

| Assumption | Rationale |
|------------|-----------|
| Product name in UI may still say “Aura” while docs say Recall | Existing branding — out of scope |
| Feature flag can start as env `VOICE_FIRST_ENABLED` later | No LaunchDarkly in repo |
| TTS privacy equals current Ask-to-OpenAI boundary | No new vendor for TTS |

### Tests run (M1 baseline)

| Check | Result |
|-------|--------|
| API typecheck | Pass |
| Frontend typecheck | Pass |
| API vitest (2 workers) | **504 passed / 74 files** |
| Frontend build | Pass (chunk size warning only) |

---

## Milestone 2 + PWA transcription (2026-07-30)

### Goal

Typed capture through Voice First facade; maximize PWA microphone usability.

### Changes made

- Voice First facade with temporal resolution and plan enrichment.
- `/ai/plan` routes through `receiveVoiceCapture` (backward-compatible PlanResult + temporal extras).
- `POST /ai/transcribe` multipart endpoint (Whisper); audio bytes never logged.
- MicButton: browser STT when available; otherwise record → upload → transcribe (tap to stop).
- Existing MicButton on Today + Ask continues as the talk surface.

### Files changed / added

| File | Action |
|------|--------|
| `artifacts/api-server/src/services/voice-first/types.ts` | Added |
| `artifacts/api-server/src/services/voice-first/temporal.ts` | Added |
| `artifacts/api-server/src/services/voice-first/temporal.test.ts` | Added |
| `artifacts/api-server/src/services/voice-first/pipeline.ts` | Added |
| `artifacts/api-server/src/services/voice-first/index.ts` | Added |
| `artifacts/api-server/src/services/voice-first/providers/transcription.ts` | Added |
| `artifacts/api-server/src/services/voice-first/providers/openai-whisper.ts` | Added |
| `artifacts/api-server/src/services/voice-first/transcription.test.ts` | Added |
| `artifacts/api-server/src/routes/ai.ts` | Modified (`/ai/plan`, `/ai/transcribe`) |
| `artifacts/api-server/src/services/audit.ts` | Modified (labels) |
| `artifacts/api-server/.env.example` | Modified |
| `artifacts/recall-app/src/lib/utterance-recorder.ts` | Added |
| `artifacts/recall-app/src/hooks/use-speech-input.ts` | Modified (server mode) |
| `artifacts/recall-app/src/components/MicButton.tsx` | Modified |
| `artifacts/recall-app/src/lib/speech-support.ts` | Modified (PWA copy) |
| `artifacts/recall-app/src/lib/recall-api.ts` | Modified (`transcribeUtterance`) |
| `docs/voice-first/08-implementation-log.md` | Updated |

### Migrations

None.

### Tests run

| Check | Result |
|-------|--------|
| API typecheck | Pass |
| Frontend typecheck | Pass |
| `voice-first` vitest | **8/8 pass** |
| action-orchestrator + intent-router | **37/37 pass** |
| Frontend build | Pass |

### Known limitations

- Durable `action_proposals` table not yet added (still client-side confirm drafts).
- Person/project auto-link on confirm not yet wired (Milestone 4–5).
- Server STT requires `OPENAI_API_KEY` (same as rest of AI).
- iOS PWA: tap mic → speak → **tap again to stop** (push-to-talk), then brief “Transcribing…”.
- Whisper cost/latency not yet metered beyond audit metadata (byte length, durationMs).
- Spoken “yes” auto-confirm deferred; tap-to-confirm only.

### Recommended next step

Push/deploy this PWA mic path for real-device validation, then Milestone 4–5: entity resolution on confirm + durable proposals + vertical-slice golden test for the John/MRI/Smith reminder.

---

## Milestone 3 follow-up + Milestone 4 (2026-07-30)

### Goal

Remove the second tap from the PWA mic, then resolve spoken person/project
references against the user's own records and carry them through confirm.

### Real-device result (iPhone PWA)

Mic, upload, Whisper, and transcript insertion all worked. User feedback: it was
push-to-talk, not live. Confirmed as intended for batch STT; addressed below by
ending the utterance on a trailing pause.

### Changes made

**Auto-stop (Milestone 3 follow-up)**

- `SilenceTracker`: clock-injected decision logic; ends an utterance after 1.8s
  of trailing quiet, once at least 300ms of speech has been heard.
- Guards added: 60s hard cap (a forgotten recording can no longer grow past the
  5 MB upload limit) and an 8s no-speech timeout that skips the upload entirely.
- WebAudio `AnalyserNode` sampled every 100ms feeds the tracker; absent WebAudio
  the recorder silently falls back to manual stop only.
- Manual tap and auto-stop race safely: `stopServer` claims the recorder ref
  before awaiting, so only one path uploads.

**Entity resolution (Milestone 4)**

- `resolveEntityMention`: tiered matching (alias > exact > word-prefix >
  contains). **Ties are reported as `ambiguous`, never guessed** — the gap in
  `matchPersonId`, which returned the first hit and could link the wrong John.
- Spoken filler is stripped for projects ("the Smith project" → `Smith`).
- `PlanResult.mentions` exposes classifier-extracted names; `receiveVoiceCapture`
  resolves them and sets `draft.personId` / `draft.projectId` only when
  unambiguous, appending "Linked to …" to the action reason.
- `ownedLinks` re-verifies both ids against the caller's own records on confirm.
  Client-supplied ids are untrusted; a foreign id is dropped, not rejected, so a
  bad link never blocks creating the item.
- Ambiguity surfaces in `AskReviewCards` as a one-tap candidate picker.

### Files changed / added

| File | Action |
|------|--------|
| `artifacts/recall-app/src/lib/utterance-recorder.ts` | Modified (SilenceTracker, RMS, auto-stop) |
| `artifacts/recall-app/src/lib/utterance-recorder.test.ts` | Added |
| `artifacts/recall-app/src/hooks/use-speech-input.ts` | Modified (auto-stop wiring, stop race) |
| `artifacts/recall-app/src/components/MicButton.tsx` | Modified (copy) |
| `artifacts/recall-app/vitest.config.ts` | Added |
| `artifacts/recall-app/package.json` | Modified (vitest, test scripts) |
| `.github/workflows/ci.yml` | Modified (frontend unit test step) |
| `artifacts/api-server/src/services/voice-first/resolve-entities.ts` | Added |
| `artifacts/api-server/src/services/voice-first/resolve-entities.test.ts` | Added |
| `artifacts/api-server/src/services/voice-first/pipeline.test.ts` | Added (golden slice) |
| `artifacts/api-server/src/services/voice-first/pipeline.ts` | Modified (link resolution) |
| `artifacts/api-server/src/services/voice-first/index.ts` | Modified (exports) |
| `artifacts/api-server/src/services/voice-first/providers/openai-whisper.ts` | Modified (video/* container labels) |
| `artifacts/api-server/src/services/action-orchestrator.ts` | Modified (mentions, ownedLinks, link passthrough) |
| `artifacts/api-server/src/services/action-orchestrator.test.ts` | Modified (ownership tests) |
| `artifacts/api-server/src/routes/ai.ts` | Modified (confirm accepts personId/projectId) |
| `artifacts/recall-app/src/lib/recall-api.ts` | Modified (link types) |
| `artifacts/recall-app/src/components/ask/AskReviewCards.tsx` | Modified (clarification picker) |
| `artifacts/recall-app/src/pages/Dashboard.tsx` | Modified (passes links) |

### Migrations

None. `attention_items.person_id/project_id` and `tasks.project_id/
requester_person_id` already existed and were simply never populated from Ask.

### Architectural decisions

1. **New infrastructure, flagged:** vitest added to `recall-app` (matching the
   api-server version) plus a CI step. Client logic was previously untestable.
2. **Ambiguity is a first-class state,** not a low-confidence resolve. A wrong
   silent link is worse than one extra question.
3. **Ownership re-checked at confirm,** because resolution happening server-side
   does not make the round-tripped id trustworthy.

### Tests run

| Check | Result |
|-------|--------|
| API typecheck | Pass |
| Frontend typecheck | Pass |
| API vitest (2 workers) | **545 passed / 78 files** (was 512/76) |
| Frontend vitest | **12 passed / 1 file** (new) |
| Frontend build | Pass |

### Known limitations

- Auto-stop thresholds are unit-tested but not tuned against real noisy rooms;
  1.8s may still clip slow speakers.
- Auto-stop needs WebAudio; without it the mic stays push-to-talk.
- Still batch STT: no live partial transcript, no barge-in. True streaming needs
  a WebSocket provider (Milestone 6 decision).
- Resolution reads only `personName` / `suggestedProject` from the existing
  classifier; multiple people in one utterance are not handled.
- Ambiguity picker choice is not persisted as an alias, so the same phrasing
  asks again next time.
- Durable `action_proposals` table still deferred; confirm remains client-held.

### Recommended next step

Milestone 5: persist proposals server-side so corrections ("make that Friday")
and cancellation have an auditable identity, and record the ambiguity picker's
choice as a person alias so Aura stops re-asking.

---

## Cost investigation — OpenAI spend controls

Triggered by ~$50 of OpenAI spend in a month against very light interactive use.

### What was actually happening

No background timer calls OpenAI. The job poller (2s), SMS and briefing sweeps
(60s) and finance auto-sync (30m) make zero model calls, so an idle deployment
costs nothing. Spend tracks **ingested data**, not app usage: each new Gmail
message can trigger a deadline extraction and a waiting-on extraction, each
note or capture over ~800 characters triggers a digest, and each image
attachment triggers a vision call.

**The defect:** `processPendingAttachmentExtractions` selects up to 4
attachments with `extracted_at IS NULL` every 15 seconds and enqueued each with
`newExtractionJobId()` — a fresh random id. `enqueueJob` de-duplicates on job id
only (`onConflictDoNothing({ target: jobs.id })`), so nothing collapsed the
repeats. A vision call takes seconds, so the same rows were still unprocessed on
the next tick and were queued again. The same image could be billed many times
over. The Gmail scans were already immune — they use a stable id bucketed to
5 minutes.

### Changes

| File | Change |
|------|--------|
| `lib/db/migrations/0031_ai_usage.sql` | New `ai_usage` table (metadata only) |
| `lib/db/src/schema/ai-usage.ts` | Drizzle schema + export |
| `artifacts/api-server/src/services/ai-usage.ts` | New: pricing, recording, budget guard, kill switches, feature attribution |
| `artifacts/api-server/src/services/attachment-text-extract.ts` | Stable `ocrJobId`; backfill skips rows that already have a job; OCR guard, usage recording, `detail`/model/size knobs |
| `artifacts/api-server/src/services/ai.ts` | Client instrumented once so every completion records usage |
| `artifacts/api-server/src/services/digests.ts` | Budget guard + feature tag |
| `artifacts/api-server/src/services/attention-extract.ts` | Budget guard + feature tag |
| `artifacts/api-server/src/services/waiting-extract.ts` | Budget guard + feature tag |
| `artifacts/api-server/src/services/capture-pipeline.ts` | Feature tag |
| `artifacts/api-server/src/services/intent-router.ts` | Feature tag |
| `artifacts/api-server/src/services/query-engine.ts` | Ask wrapped in a feature scope |
| `artifacts/api-server/src/routes/ai-usage.ts` | New `GET /api/ai/usage` |
| `artifacts/api-server/.env.example` | Cost-control documentation |

### Architectural decisions

1. **Attribution via `AsyncLocalStorage`, not a threaded argument.** The AI
   service makes completions from ~15 places; tagging at the semantic boundary
   keeps accounting out of every call site and means a new call site cannot
   silently escape it.
2. **The budget caps background work only.** Going silent in the middle of a
   user's question is worse than the marginal cost of answering it.
3. **Unknown models price at the most expensive known rate,** so a model swap
   cannot slip past the cap by looking free.
4. **`detail: "low"` is the OCR default.** Extracted text only feeds search
   indexing, and image tokens otherwise scale with resolution. `OPENAI_OCR_DETAIL=high`
   restores fidelity.
5. **The backfill skips attachments that already have a job row.** The stable id
   alone would have stranded the sweep on permanently failed rows.

### Tests run

| Check | Result |
|-------|--------|
| API typecheck | Pass |
| Frontend typecheck | Pass |
| API vitest (2 workers) | **572 passed / 80 files** (was 545/78) |
| Frontend vitest | 12 passed / 1 file |

### Known limitations

- Pricing is a hardcoded table for budgeting and reporting only; OpenAI's
  invoice remains authoritative.
- Streamed Ask answers report no `usage` block, so those calls are not recorded.
  Capturing them needs `stream_options: { include_usage: true }`.
- Embeddings, Whisper and TTS are not instrumented; they are cheap relative to
  chat and vision, but they are therefore missing from the breakdown.
- The budget is global and resets at midnight **UTC**, not in the user's
  timezone, and is cached for up to 60s so it can overshoot slightly.
- `ai_usage` starts empty, so it explains future spend, not the past $50.
