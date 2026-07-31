# Voice First — Rollout Plan

**Date:** 2026-07-31  
**Milestone:** 6

## Feature flags (env)

| Flag | Default | Effect |
|------|---------|--------|
| `RECALL_SERVER_STT_ENABLED` | on | Kill paid Whisper only; browser STT unaffected |
| `RECALL_OPENAI_TTS_ENABLED` | on | Kill paid TTS; browser speech unaffected |
| `RECALL_ATTACHMENT_OCR_ENABLED` | on | Kill vision OCR |
| `RECALL_BACKGROUND_AI_ENABLED` | on | Kill all background AI |
| `AI_DAILY_BUDGET_USD` | unset | Cap background spend (UTC day) |
| `AI_DAILY_BUDGET_USD_PER_USER` | unset | Soft cap on Ask when exceeded |

Client: `recall.premiumTts` localStorage (off by default).

## Rollback

1. Set kill switches in `.env`  
2. `pm2 restart recall-api recall-worker --update-env`  
3. Confirm remains available via draft path if proposal table is unavailable  

## Promotion metrics

Successful confirm rate, correction rate, duplicate-action rate, P95 plan latency, $/day from `GET /api/ai/usage`.
