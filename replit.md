# Recall — AI Personal Assistant

Recall is an AI-first personal assistant for notes, tasks, and canvas. **Production:** [https://recall-app.net](https://recall-app.net)

## Run & Operate

- `pnpm dev` — frontend locally (port 5173)
- `pnpm dev:api` — API locally (port 5008, matches production)
- **Production:** see [DEPLOYMENT.md](./DEPLOYMENT.md) — DigitalOcean `159.223.130.69`, nginx → **port 5008**
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- **AI (api-server `.env`):** `OPENAI_API_KEY`, optional `OPENAI_MODEL` (default `gpt-4o-mini`), `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-small`)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Product

- **Website:** https://recall-app.net
- **App name (UI):** Recall
- Dashboard, Notes, Tasks, and Canvas with glassmorphism UI
- AI layer (chat, summarization, task extraction, semantic search) — in progress

## User preferences

- Production domain for this app is **recall-app.net** (not a separate marketing site).
- Product branding is **Recall**, not Aura.

## Where things live

- **Frontend:** `artifacts/recall-app` (`@workspace/recall-app`)
- **API:** `artifacts/api-server` (PM2 name `recall-api`, port 5008)
- **Server deploy path:** `/var/www/recall-app`

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
