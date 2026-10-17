# Voice First — Rollout Plan

**Date:** 2026-07-31  
**Milestone:** 6

## Feature flags (env)

| Flag                                      | Default | Effect                                           |
| ----------------------------------------- | ------- | ------------------------------------------------ |
| `RECALL_SERVER_STT_ENABLED`               | off     | Enable paid Whisper; browser STT unaffected      |
| `RECALL_OPENAI_TTS_ENABLED`               | off     | Enable paid TTS; browser speech unaffected       |
| `RECALL_ATTACHMENT_OCR_ENABLED`           | off     | Enable vision OCR                                |
| `RECALL_AI_DIGESTS_ENABLED`               | off     | Enable note/capture digest AI                    |
| `RECALL_EMAIL_AI_SCAN_ENABLED`            | off     | Enable deadline, waiting, and outcome extraction |
| `RECALL_HOME_AI_DIGEST_ENABLED`           | off     | Enable hash-cached Home hero prose               |
| `RECALL_EMBEDDING_WARM_ENABLED`           | off     | Enable hash-cached save/sync-time vectors        |
| `RECALL_BACKGROUND_AI_ENABLED`            | off     | Parent switch for all background/save-time AI    |
| `RECALL_HOME_AI_DIGEST_DAILY_LIMIT`       | 3       | Per-user Home digest calls per UTC day           |
| `RECALL_EMBEDDING_WARM_DAILY_LIMIT`       | 100     | Per-user embedding warm calls per UTC day        |
| `RECALL_EMBEDDING_WARM_DAILY_TOKEN_LIMIT` | 100000  | Per-user embedding warm tokens per UTC day       |
| `AI_DAILY_BUDGET_USD`                     | $0.50   | Install-wide background spend cap (UTC day)      |
| `AI_BACKGROUND_DAILY_BUDGET_USD_PER_USER` | $0.50   | Per-user background spend cap                    |
| `AI_DAILY_BUDGET_USD_PER_USER`            | $0.50   | Per-user Ask spend cap                           |

Unset, zero, or invalid budget values use the documented finite defaults.
Spend-read errors fail closed. Cache hits do not write `ai_usage` rows because
no provider call occurred; failed provider attempts write zero-token/zero-cost
rows so attempted calls remain visible.

Client: `recall.premiumTts` localStorage (off by default).

## Rollback

1. Set kill switches in `.env`
2. `pm2 restart recall-api recall-worker --update-env`
3. Confirm remains available via draft path if proposal table is unavailable

## Promotion metrics

Successful confirm rate, correction rate, duplicate-action rate, P95 plan latency, $/day from `GET /api/ai/usage`.
