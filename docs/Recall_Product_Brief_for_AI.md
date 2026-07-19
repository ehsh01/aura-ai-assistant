# Recall — Product Brief (for AI assistants)

Use this document as context when helping with Recall. Prefer this over guessing from the GitHub folder name “Aura AI Personal Assistant.”

---

## What it is

**Recall** is an AI-powered **personal operating system** — a single command center for one person’s work, home, family, money, documents, and follow-ups.

Live product: **https://recall-app.net**

It is **not** meant to replace Gmail, Drive, Evernote, a finance ledger, or a task app as systems of record. It is an **intelligence layer** that connects those sources, turns scattered inputs into structured memory, and answers questions with **evidence** from the user’s own data.

The workspace/repo may still be named “Aura,” but **product branding is Recall, not Aura.**

---

## Mission

> **Capture once. Organize automatically. Act with confidence. Verify everything.**

Recall exists because the problem is not “not enough apps” — it is that each app holds only part of the truth (email, notes, texts, finance, construction records, family facts, tickets, documents). Recall reduces mental load by making that information **searchable, connected, actionable, and verifiable.**

---

## What it tries to accomplish

1. **Capture without friction** — paste, brain-dump, upload, browser extension, Evernote import, connector sync.
2. **Organize automatically** — AI extracts structure into an inbox the user can accept, correct, or dismiss.
3. **Remember permanently** — Life Memory for facts that should not get buried in notes (“teach once, ask forever”).
4. **Answer from the user’s world** — Ask Recall answers questions using notes, memories, people, projects, synced mail/files/finance, and more.
5. **Show receipts** — important answers should be backed by evidence (what source, what record), not black-box hallucinations.
6. **Stay a connector, not a replacement** — Google, finance APIs, etc. remain authoritative; Recall syncs and cites them.

---

## Who it is for

Primarily built as a **personal command center for one power user** (IT/work follow-ups, family/home/construction context, personal finance questions, email/Drive lookup, permanent life facts). Design assumes interrupt-driven work: capture must be fast; Ask must be trustworthy.

---

## Core product areas

| Area | What it does |
|------|----------------|
| **Home / Ask** | Natural-language Q&A (“oracle” surface), threaded follow-ups, optional spoken answers |
| **Today** | Daily briefing: focus, waiting-on, timeline, finance snapshot, quick capture |
| **Notes (Memory)** | Notebooks, rich notes, tags, person links, search — including text inside attached images/PDFs after extraction/OCR |
| **AI Inbox** | Review AI-extracted captures; accept into notes, tasks, or Life Memory |
| **Life Memory** | Permanent domain facts (family, home, vehicles, health, work, finance, etc.) |
| **Knowledge** | Structured reusable items (procedures, references, contacts, snippets) |
| **People** | Lightweight CRM: people linked to notes, tasks, follow-ups (“waiting on”) |
| **Projects** | Group notes, tasks, captures, and people around ongoing efforts |
| **Tasks** | Prioritized follow-ups, often created from captures or Ask |
| **Documents** | Uploaded/imported docs with summarize and evidence links |
| **Connectors** | Link Google and finance sources; manage sync |
| **Activity** | Audit-style history of captures, accepts, syncs, Ask answers |
| **Browser extension** | Capture the current page/context into Recall |

---

## Connected data sources (current)

- **In-app:** notes, notebooks, tasks, captures, life memories, knowledge, documents, people, projects, evidence/activity
- **Google (OAuth, read-only, multi-account):** Gmail, Calendar, Contacts, Drive
- **Finance API:** synced personal finance transactions (external ledger remains source of truth; often referred to in context of MyFamilyBudget-style data)
- **CSV import:** tabular dumps synced as source records
- **Evernote:** `.enex` import (notes + attachments)
- **Manual / extension capture:** freeform text and page context

Vision/docs may mention Outlook, Teams, ticketing, etc.; treat those as **roadmap aspirations** unless clearly implemented.

---

## How Ask / search is distinctive

- **Evidence-backed:** answers emphasize confidence, caveats, and related sources when possible.
- **Hybrid retrieval:** keyword + embeddings over notes, memories, knowledge, people, tasks, documents, captures, and synced records.
- **Life Memory priority:** permanent facts (especially family/relationship questions) are boosted over ephemeral notes.
- **Live Gmail & Drive search:** when a question looks like mail/file lookup, Recall can run live searches across connected Google accounts (not only a stale sync cache). Drive search can hit Google’s full-text index (including OCR’d PDFs/scans).
- **Attachment text:** note attachments (PDFs, text, images via vision OCR) are extracted so Notes search and Ask can find text that only lived inside a photo or scan (e.g. a VIN on a registration card) — after extraction has completed for that file.
- **Finance answers:** drawn from **synced** transactions (with refresh), not invented balances.
- **Waiting-on / people intents:** dedicated handling for “what am I waiting on?” and person-centric questions.
- **Privacy awareness:** Ask can surface which data categories / model involvement applied to a turn.

---

## What Recall is *not*

- Not “ChatGPT with a different skin” — it should ground answers in **user-owned data**.
- Not a replacement finance app, email client, or Drive.
- Not a generic multi-tenant SaaS pitch deck product — it is a **unified personal OS** with modules over one knowledge graph.
- Not allowed to silently invent facts about the user’s life, money, or people without evidence.

---

## Product principles (non-negotiable)

1. **Preserve raw source data** — don’t destroy originals when AI structures them.
2. **Evidence for trust** — important claims should be showable/citable.
3. **External systems stay source of truth.**
4. **Capture must be fast** (one or two actions).
5. **Human correction of AI output** is first-class (inbox accept/edit/dismiss).
6. **One app, many views** of the same connected data — not siloed mini-apps.
7. **Modular connectors** over one-off integrations.

---

## Tech snapshot (for implementation questions)

- **Frontend:** React + Vite + TypeScript (`artifacts/recall-app`)
- **API:** Express TypeScript (`artifacts/api-server`), OpenAPI → typed client + Zod
- **DB:** PostgreSQL + Drizzle
- **AI:** OpenAI (chat, embeddings, vision OCR, TTS)
- **Hosting:** DigitalOcean + nginx + PM2; production domain **recall-app.net**
- **Monorepo:** pnpm workspaces

---

## How to help when working on Recall

When suggesting features, copy, architecture, or answers about the product:

1. Stay aligned with the mission and principles above.
2. Prefer **evidence, connectors, and capture → inbox → memory** flows over “just another chatbot feature.”
3. Do not assume Outlook/Teams/tickets exist unless the codebase shows them.
4. Use the name **Recall**, not Aura, in user-facing language.
5. When uncertain whether something ships today vs. is vision-only, say so.

---

## One-paragraph elevator pitch

Recall is Ernesto’s AI personal operating system at recall-app.net: capture anything once, let AI organize it, keep permanent life facts in memory, and ask natural-language questions across notes, people, projects, Gmail, Drive, and finance — with answers grounded in evidence from his own sources rather than replacing those apps.
