# Recall one-box Phase 1

This document is the implementation spec for the Phase 1 Explore change. The
user-facing product name is **Recall**.

Implementation is stacked on the PR #30 voice/TTS foundation at
`ab5bb9fb80ca5a39907c6bd96995a48653360c0e`.

## One box

Explore has one input at the bottom on desktop and mobile. It accepts text,
links, dropped or pasted files and images, a file picker, and the single large
ring microphone. The old top capture bar, second microphone, source tabs, and
all filter chips are removed. Graph/Grid remains.

## Deterministic save or search

No model classifies an entry. First match wins:

1. attached file: save
2. leading `save`, `remember`, `note`, `keep`, or `add`: save
3. leading `find`, `look up`, `search`, or `show`: search
4. bare HTTP(S) URL: save
5. ends in `?`: search
6. starts with a question word: search
7. five words or fewer: search
8. otherwise: save

Cmd/Ctrl+Enter forces save. A leading `?` forces search. A save shows
`Saved · Undo` for eight seconds; Undo deletes only the item created by that
submission. Search shows `Searching · Save instead`.

Free search runs first across saved items, notes, Evernote, Gmail, Drive,
Calendar, and finance. Every result card carries its source, notebook when
available, and date. Ask AI remains an explicit tap and uses the existing
limits and kill switches.

## Voice

Voice transcripts use the same deterministic save/search rules. A voice search
then uses the existing capped Talk answer path and onyx server TTS. Browser TTS
is permitted only when server TTS reports the kill switch or daily cap.

During a voice answer Recall shows no answer text, source link, result card, or
document card. Only a minimal listening/speaking state, Stop, and a visible
Show action may be present.

`show me`, `show it`, and `let me see` are matched locally. Spoken Show or the
visible Show action reveals the cached proof from the preceding voice ask:
the supporting source records and any document card with Open and Download.
It performs no new search and no AI call. With no prior voice answer, Recall
shows a short `Nothing to show yet` message without searching.

For a document answer, the same TTS utterance ends with the short prompt:
`I found the document; say "show me" to open it.` No second clip is generated.
Typed searches and typed Ask AI answers retain their normal on-screen results.

## Document security

Recall-native, Gmail, Drive, and Evernote downloads use authenticated
owner-scoped Recall endpoints. Connector URLs are never exposed as download
URLs. Gmail and Evernote attachment bytes are fetched read-only at click time,
streamed to the authenticated owner, and are not written to public storage.

## Cost and schema

Free search disables semantic query embeddings and makes no model call.
Classification and presentation are rules. This phase adds no paid service and
requires no database migration.
