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
