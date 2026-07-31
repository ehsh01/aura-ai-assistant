# Voice First — Security and Privacy

**Date:** 2026-07-31

- All proposal / confirm / cancel / correct routes require auth and are user-scoped.
- Person/project ids on drafts are re-validated with `ownedLinks` before write.
- Audit logs store ids, lengths, and outcome categories — not raw transcripts.
- `ai_usage` stores tokens/cost/feature only — never prompt or completion text.
- Audio for Whisper is not persisted beyond the request; transcription is not logged.
- Kill switches: `RECALL_SERVER_STT_ENABLED`, `RECALL_OPENAI_TTS_ENABLED`, background AI flags, daily budgets.
