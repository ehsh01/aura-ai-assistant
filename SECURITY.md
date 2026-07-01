# Recall — Security

## Current posture (production)

| Layer | Protection |
|-------|------------|
| **TLS** | HTTPS via Let's Encrypt + Cloudflare |
| **API exposure** | Listens on `127.0.0.1:5008` only — not reachable from the internet directly |
| **Reverse proxy** | nginx terminates SSL and proxies `/api` |
| **CORS** | Only `https://recall-app.net` and `https://www.recall-app.net` (override with `CORS_ORIGINS`) |
| **Rate limits** | 200 req / 15 min general API; 30 AI req / 15 min per IP |
| **Headers** | Helmet (API) + HSTS, X-Frame-Options, etc. (nginx) |
| **Secrets** | `.env` gitignored; should be mode `600` on server |
| **Logs** | Authorization headers redacted in pino |

## Known gaps (planned)

- **No user authentication yet** — anyone who can load the site can call `/api/ai/*` (rate-limited). Add login (JWT/sessions) before storing real personal data.
- **No database persistence yet** — mock data in the SPA; lower risk until Postgres is wired.

## Server checklist (run on droplet)

```bash
# .env readable only by root
chmod 600 /var/www/recall-app/artifacts/api-server/.env

# API should bind localhost only
ss -tlnp | grep 5008   # expect 127.0.0.1:5008

# Confirm HTTPS headers
curl -sI https://recall-app.net | grep -iE 'strict-transport|x-frame|x-content'
```

## Cloudflare (recommended)

1. **SSL/TLS mode:** Full (strict)
2. **Bot Fight Mode** or WAF rate rule on `/api/ai/*`
3. **Cache:** bypass for `/api/*`
4. Purge cache after deploys

## Environment variables

See `artifacts/api-server/.env.example` — never commit `.env`.

## Reporting issues

Rotate `OPENAI_API_KEY` immediately if exposed. Regenerate droplet SSH keys if compromised.
