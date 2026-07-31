# Voice First — Evaluation Plan

**Date:** 2026-07-31  
**Milestone:** 6

## Layers already in CI

1. Unit: temporal, entity resolution, silence tracker, pricing/budget, OCR job id, weekday corrections  
2. Orchestrator: draft mapping, owned links, capture status  
3. Pipeline golden: “tomorrow morning… John… Smith project”  

## Still optional (live provider, budget-gated)

- Live Whisper accuracy on iOS MediaRecorder blobs  
- End-to-end UI record → confirm on a staging user  

## Golden cases to keep adding

Messy speech, ambiguous Johns, “make that Friday”, cancel, duplicate confirm, prompt injection in captured text.
