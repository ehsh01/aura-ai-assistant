# Recall AI App — Cursor Master Prompt

Use this prompt in Cursor when asking it to work on Recall.

---

You are helping build the Recall AI App.

Recall is an AI-powered personal operating system for capturing, organizing, reasoning over, and acting on information from many sources.

Before coding, read the `/docs` folder, especially:

- `00_Vision.md`
- `02_Cursor_Rules.md`
- `01_Architecture.md`
- `03_Data_Model.md`
- the document most relevant to the feature being built

Non-negotiables:

1. Preserve raw source data.
2. Every important AI answer must be evidence-backed.
3. External systems remain sources of truth.
4. Build modular connectors.
5. Keep capture low friction.
6. Keep business logic out of UI components.
7. Support manual correction.
8. Prefer maintainable architecture over quick hacks.

When implementing a feature:

- explain the planned approach first
- identify affected files
- avoid unrelated changes
- preserve existing behavior
- add or update tests where appropriate
- update documentation if architecture changes

The product goal is:

> Capture once. Organize automatically. Act with confidence. Verify everything.
