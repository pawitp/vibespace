# vibespace

`vibespace` is a private Cloudflare Worker platform for personal vibe-coded utilities.

- Utilities are stored as single-page HTML files in GitHub (`apps/<app-id>/index.html`)
- Binary assets (for example images) are content-addressed and stored in Cloudflare R2
- Per-app key/value state for each single-page app runtime is stored next to each app (`apps/<app-id>/kv.json`)
- Data is managed through REST API and persisted via GitHub Contents API
- Auth uses passkeys (WebAuthn) + short-lived bearer tokens (single-owner)
- This repository contains only Worker code; app data must be stored in a separate GitHub data repository.

## Architecture

- Runtime: Cloudflare Workers (serverless, low maintenance)
- Storage: separate GitHub data repository (not this Worker repository)
- Asset blob storage: Cloudflare R2 bucket (content-addressed by file bytes)
- Auth credential storage: Cloudflare D1 (`PASSKEYS_DB`)
- UI shell: static `public/index.html` served through authenticated Worker route
- Auth flow:
  1. Open `/auth/login`
  2. Authenticate with a registered passkey
  3. Browser session cookie is set
  4. Use `/auth/token` to mint a short-lived bearer token for `/api/*`

## API

Base URL: `https://<your-worker-domain>`

Public routes:
- `GET /health` - health check
- `GET /agent-template` - download a single local-agent instruction file (`AGENTS.md`)
- `GET /auth/login` - passkey login page
- `GET /auth/register/{token}` - one-time token passkey registration page
- `GET /auth/logout` - clear browser session cookie and redirect to login page
- `POST /auth/passkey/login/options` - begin passkey login
- `POST /auth/passkey/login/verify` - verify passkey login and set session cookie
- `POST /auth/passkey/register/options` - begin passkey registration (requires valid one-time registration token)
- `POST /auth/passkey/register/verify` - finalize passkey registration and consume token

Authenticated browser routes (login required):
- `GET /` and `GET /index.html` - index page asset; client calls JSON APIs (for example `GET /api/apps`)
- `GET /apps/{appId}` - serves stored app HTML
- `GET /auth/token` - issue a fresh short-lived bearer token for local agent use

Authenticated API routes (either bearer token OR logged-in browser session cookie):
- `GET /api/apps`
- `DELETE /api/apps/{appId}`
- `POST /api/apps/{appId}/rename`
- `GET /api/apps/{appId}/html`
- `PUT /api/apps/{appId}/html`
- `GET /api/apps/{appId}/kv`
- `PUT /api/apps/{appId}/kv`
- `PUT /api/assets`
- `GET /api/assets/{assetId}`
- `HEAD /api/assets/{assetId}`
- `POST /api/proxy`

When an app is loaded from vibespace (`/apps/{appId}`), app-side requests to `/api/*` can use the existing browser session cookie. No additional token handling is needed inside the app.

### `PUT /api/apps/{appId}/html`

Either raw HTML body or JSON.

Commit message may be provided by:
- JSON body field `message`
- Header `X-Vibespace-Message`
- Query parameter `?message=...`

JSON format:

```json
{
  "html": "<!doctype html><html>...</html>",
  "message": "optional commit message"
}
```

Raw file upload example:

```bash
curl -sS -X PUT "https://<your-worker-domain>/api/apps/<app-id>/html" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: text/html; charset=utf-8" \
  -H "X-Vibespace-Message: update <app-id> html" \
  --data-binary @./app.html
```

### `PUT /api/apps/{appId}/kv`

Body must be a JSON object; it replaces the full per-app runtime state payload.

### `PUT /api/assets`

Uploads binary data and returns a stable content-based asset ID and path.

Constraints:
- Authentication required.
- `Content-Type` is required and must be one of:
  - `image/avif`
  - `image/gif`
  - `image/jpeg`
  - `image/png`
  - `image/svg+xml`
  - `image/webp`
- If the same bytes are uploaded again, the same asset ID/path is returned.

Example:

```bash
curl -sS -X PUT "https://<your-worker-domain>/api/assets" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: image/png" \
  --data-binary @./image.png
```

Response shape:

```json
{
  "ok": true,
  "assetId": "<asset-id>",
  "contentType": "image/png",
  "path": "/api/assets/<asset-id>"
}
```

### `GET /api/assets/{assetId}`

Returns the stored binary object with its original content type. Access requires authentication.

### `POST /api/proxy`

Fetches a third-party page and streams it back.

Constraints:
- Authentication required.
- Only `https://` target URLs are allowed.
- Localhost and private-network targets are blocked.
- Intended for simple page fetches from app code.

Request body must be JSON:

```json
{
  "url": "https://example.com"
}
```

### `POST /api/apps/{appId}/rename`

Body must be JSON with a destination app ID:

```json
{
  "to": "new-app-id"
}
```

Behavior:
- Copies `apps/{appId}/index.html` and `apps/{appId}/kv.json` to the new app ID.
- Deletes source files after copy succeeds.
- Returns `409` if destination already exists.

## Setup

1. Create a separate GitHub data repo (example: `vibespace-data`) and initialize:

```bash
mkdir -p apps
touch app/.gitkeep
git add apps
git commit -m "init apps folder"
```

2. Create your local `wrangler.toml` from the sample:

```bash
cp wrangler.toml.sample wrangler.toml
```

Then fill in your values in `wrangler.toml` (`GITHUB_DATA_OWNER`, `GITHUB_DATA_REPO`, `PASSKEY_*`).
`wrangler.toml` is gitignored so local defaults do not get committed.

3. Create a D1 database for passkeys and bind it to `PASSKEYS_DB`:

```bash
npx wrangler d1 create vibespace-passkeys
```

Then add the returned values to `wrangler.toml`:

```toml
[[d1_databases]]
binding = "PASSKEYS_DB"
database_name = "vibespace-passkeys"
database_id = "<database-id-from-create-command>"
```

4. Create an R2 bucket for binary assets and bind it to `ASSET_BLOBS`:

```bash
npx wrangler r2 bucket create <r2-asset-bucket-name>
```

Then add the binding in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "ASSET_BLOBS"
bucket_name = "<r2-asset-bucket-name>"
```

5. Apply D1 migrations (creates `passkey_credentials` and `registration_tokens`):

```bash
npx wrangler d1 migrations apply <d1-database-name> --remote
```

6. Install dependencies:

```bash
npm install
```

7. Configure Worker vars in `wrangler.toml` and with secrets:

Required bindings:
- `PASSKEYS_DB` (D1)
- `ASSET_BLOBS` (R2)

Required vars:
- `GITHUB_DATA_OWNER`
- `GITHUB_DATA_REPO`
- `PASSKEY_OWNER_SUB` (example: `github-user`)
- `PASSKEY_RP_ID` (example: `vibespace.cf-user.workers.dev`)
- `PASSKEY_ORIGIN` (example: `https://vibespace.cf-user.workers.dev`)

Optional vars:
- `GITHUB_BRANCH` (default `main`)
- `TOKEN_TTL_SECONDS` (default `86400`, one day)


Required secrets:

```bash
wrangler secret put GITHUB_PAT
wrangler secret put SESSION_SECRET
```

8. Run locally:

```bash
npm run dev
```

9. Deploy:

```bash
npm run deploy
```

10. Bootstrap the first passkey:
- Create a one-time registration token (default expiry is 24 hours):

```bash
npm run passkey:add
```

- The command prints `Registration URL: https://<your-worker-domain>/auth/register/<token>`.
- Open that URL and create the passkey.
- After successful registration, the token is invalidated automatically.
- Then log in normally at `https://<your-worker-domain>/auth/login`.
