# vibespace Agent Guide

This guide is for local coding agents (Codex, Claude Code) editing a vibespace app.

## Session context

The main page command appends a `Local Session Context` section with concrete values.
Use those values directly. Do not invent defaults.

Expected keys:
- `VIBESPACE_BASE_URL`
- `VIBESPACE_APP_ID`
- `VIBESPACE_TOKEN_FILE`

Set shell vars from those values before running commands:

```bash
export VIBESPACE_BASE_URL="<from Local Session Context>"
export VIBESPACE_APP_ID="<from Local Session Context>"
export VIBESPACE_TOKEN_FILE="<from Local Session Context>"
```

## Required workflow

1. Download current app HTML to a local file.
2. Upload any new binary assets and update HTML references.
3. Test locally with `dev_server.js`.
4. Ask the user to confirm upload.
5. Upload from file with a commit message.

## Step 1: download app HTML

```bash
curl -fsS "$VIBESPACE_BASE_URL/api/apps/$VIBESPACE_APP_ID/html" \
  -H "Authorization: Bearer $(cat "$VIBESPACE_TOKEN_FILE")" \
  -o app.html
```

## Step 2: upload assets (images) before testing

Allowed upload content types:
- `image/avif`
- `image/gif`
- `image/jpeg`
- `image/png`
- `image/svg+xml`
- `image/webp`

Upload an image and capture the returned `path`:

```bash
curl -fsS -X PUT "$VIBESPACE_BASE_URL/api/assets" \
  -H "Authorization: Bearer $(cat "$VIBESPACE_TOKEN_FILE")" \
  -H "Content-Type: image/png" \
  --data-binary @./image.png
```

Then update `app.html` to reference that returned path (example: `/api/assets/<asset-id>`).

## Step 3: test locally with dev server

`dev_server.js` serves your local HTML file and exposes `GET/PUT /api/apps/{appId}/kv`.
It also proxies `GET/HEAD /api/assets/{assetId}` to upstream using your bearer token.
It also proxies `POST /api/proxy` (JSON body: `{ "url": "https://..." }`) to upstream using your bearer token.
KV behavior in dev server:
- On first `GET /kv`, it loads KV from vibespace.
- After that, KV is kept in local memory.
- `PUT /kv` updates only local memory (it does not write to vibespace).

```bash
node dev_server.js \
  --upstream "$VIBESPACE_BASE_URL" \
  --app-id "$VIBESPACE_APP_ID" \
  --html ./app.html \
  --token-file "$VIBESPACE_TOKEN_FILE"
```

Tell the user to open `http://127.0.0.1:8788/apps/$VIBESPACE_APP_ID` and verify images/assets load.

## Using proxy API (`POST /api/proxy`)

Use this API when app code needs to fetch a third-party web page.

Rules:
- URL must be provided in JSON body as `url`.
- Target URL must be `https://` only.
- Auth is required (bearer token for local agent/dev server; session cookie for logged-in browser app).
- `User-Agent` is forwarded to target site.

Example with bearer token:

```bash
curl -fsS -X POST "$VIBESPACE_BASE_URL/api/proxy" \
  -H "Authorization: Bearer $(cat "$VIBESPACE_TOKEN_FILE")" \
  -H "Content-Type: application/json" \
  --data '{"url":"https://example.com"}'
```

Example from app code:

```js
async function fetchViaProxy(targetUrl) {
  const res = await fetch("/api/proxy", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: targetUrl })
  });
  if (!res.ok) throw new Error(`proxy fetch failed: ${res.status}`);
  return await res.text();
}
```

## Step 4: confirm with user

Before upload, summarize what changed and ask for confirmation. Always write a helpful commit message.

## Step 5: upload local file with commit message

```bash
COMMIT_MESSAGE="update $VIBESPACE_APP_ID html"
curl -fsS -X PUT "$VIBESPACE_BASE_URL/api/apps/$VIBESPACE_APP_ID/html" \
  -H "Authorization: Bearer $(cat "$VIBESPACE_TOKEN_FILE")" \
  -H "Content-Type: text/html; charset=utf-8" \
  -H "X-Vibespace-Message: $COMMIT_MESSAGE" \
  --data-binary @./app.html
```

## Step 6: clean up

If server is started in step 2, don't forget to kill it.

## Runtime KV behavior

- Stored at `apps/<app-id>/kv.json`.
- Use KV only for app runtime state.
- Conflict mode is last-write-wins.
- When an app is loaded from vibespace (`/apps/{appId}`), it can call `/api/apps/{appId}/kv` directly with browser session cookie auth. No extra token flow is needed inside the app.

## Using KV inside the app

When writing app code that runs at `/apps/{appId}`, use same-origin fetch to read/write KV.

Read KV:

```js
async function loadState(appId) {
  const res = await fetch(`/api/apps/${encodeURIComponent(appId)}/kv`, {
    credentials: "include"
  });
  if (!res.ok) throw new Error(`load kv failed: ${res.status}`);
  const data = await res.json();
  return data.kv || {};
}
```

Write KV (full replace):

```js
async function saveState(appId, nextState) {
  const res = await fetch(`/api/apps/${encodeURIComponent(appId)}/kv`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(nextState)
  });
  if (!res.ok) throw new Error(`save kv failed: ${res.status}`);
}
```

Important:
- `PUT /kv` replaces the full object
- No bearer token is required in browser app code when the user is already logged in.
