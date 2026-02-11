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
2. Test locally with `dev_server.js`.
3. Ask the user to confirm upload.
4. Upload from file with a commit message.

## Step 1: download app HTML

```bash
curl -fsS "$VIBESPACE_BASE_URL/api/apps/$VIBESPACE_APP_ID/html" \
  -H "Authorization: Bearer $(cat "$VIBESPACE_TOKEN_FILE")" \
  -o app.html
```

## Step 2: test locally with dev server

`dev_server.js` serves your local HTML file and exposes only `GET/PUT /api/apps/{appId}/kv`.
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

Tell the user to open `http://127.0.0.1:8788/apps/$VIBESPACE_APP_ID`.

## Step 3: confirm with user

Before upload, summarize what changed and ask for confirmation. Always write a helpful commit message.

## Step 4: upload local file with commit message

```bash
COMMIT_MESSAGE="update $VIBESPACE_APP_ID html"
curl -fsS -X PUT "$VIBESPACE_BASE_URL/api/apps/$VIBESPACE_APP_ID/html" \
  -H "Authorization: Bearer $(cat "$VIBESPACE_TOKEN_FILE")" \
  -H "Content-Type: text/html; charset=utf-8" \
  -H "X-Vibespace-Message: $COMMIT_MESSAGE" \
  --data-binary @./app.html
```

## Step 5: clean up

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
