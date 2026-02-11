# AGENTS.md

## Project intent
- This repository contains the Cloudflare Worker platform code for `vibespace`.
- It is a private platform for personal vibe-coded utilities.
- Utilities are single-page HTML apps.

## Architecture constraints
- Keep this repo focused on Worker/platform code only.
- Do not inline full HTML pages inside route handlers; store page templates in `public/` and serve/render them from there.
- App data must be stored in a separate GitHub data repo, not in this repo.
- Data layout in the data repo:
  - `apps/<app-id>/index.html`
  - `apps/<app-id>/kv.json` (runtime state used by that app)
- GitHub Contents API is the storage backend.
- Conflict behavior for KV/data updates is last-write-wins.

## Auth and access rules
- Index page (`/`) must require authentication.
- App pages (`/apps/{appId}`) must require authentication.
- API routes (`/api/*`) must require authentication.
- Browser login is passkey-based WebAuthn (`/auth/login`).
- Browser session uses secure cookie and supports logout (`/auth/logout`).
- Local coding agents may use bearer token auth from `/auth/token` after browser login.
- Apps loaded from vibespace should be able to access KV/API automatically when the user is logged in (session cookie auth).
- Treat KV as app runtime state storage for the single-page HTML app itself.
- Passkey credentials are stored in Cloudflare D1 (`PASSKEYS_DB`), not in GitHub.

## User-facing platform behavior
- `/` lists available apps.
- `/` shows instructions to download the local agent file via curl.
- `/agent-template` serves a single downloadable `AGENTS.md` template for end users.
- Keep user guidance simple and curl-first.
- The downloadable template should drive agent behavior with this flow:
  - Download existing app HTML to local file.
  - Test locally via `dev_server.js` proxy.
  - Upload from file only after explicit user confirmation, with commit message.
- Avoid duplicated long-form instructions in UI popups; keep them in `AGENTS.md` template.

## Deployment and maintenance preferences
- Cloudflare Workers deployment.
- Low-maintenance/serverless choices preferred.
- Avoid unnecessary dependencies and complexity.

## Configuration expectations
- Required bindings:
  - `PASSKEYS_DB` (Cloudflare D1)
- Required non-secret vars:
  - `GITHUB_DATA_OWNER`
  - `GITHUB_DATA_REPO`
  - `PASSKEY_OWNER_SUB`
  - `PASSKEY_RP_ID`
  - `PASSKEY_ORIGIN`
- Required secrets:
  - `GITHUB_PAT`
  - `SESSION_SECRET`
- Do not introduce legacy fallback env names unless explicitly requested.

## Working style for future changes
- Preserve privacy-first defaults (deny unauthenticated access by default).
- Keep API and docs consistent whenever routes/auth behavior changes.
- Keep `wrangler.toml.sample` in sync whenever `wrangler.toml` is changed.
- Prefer incremental, minimal changes over broad rewrites.
- Run `npm install` outside sandbox by default.
- After completing changes, run `npx wrangler deploy` by default unless the user explicitly asks not to deploy.
- Keep local-agent instructions compatible with `dev_server.js` (no extra dependencies).
