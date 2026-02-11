import { json } from "../lib/http.js";
import {
  appHtmlPath,
  appKvPath,
  deleteGitHubFile,
  listApps,
  readGitHubJsonFile,
  readGitHubTextFile,
  writeGitHubTextFile
} from "../lib/github.js";

export async function handleAppPage(env, appId) {
  const path = appHtmlPath(appId);
  const html = await readGitHubTextFile(env, path);
  if (!html) {
    return new Response(`App ${appId} not found`, { status: 404 });
  }
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function handleApiListApps(env) {
  const apps = await listApps(env);
  return json({ apps });
}

export async function handleApiGetHtml(env, appId) {
  const path = appHtmlPath(appId);
  const html = await readGitHubTextFile(env, path);
  if (!html) {
    return json({ error: "App not found" }, 404);
  }
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function handleApiPutHtml(request, env, appId, actor) {
  const contentType = request.headers.get("content-type") || "";
  let html;
  let message = request.headers.get("x-vibespace-message") || new URL(request.url).searchParams.get("message");

  if (contentType.includes("application/json")) {
    const body = await request.json();
    html = body.html;
    message = body.message || message;
  } else {
    html = await request.text();
  }

  if (typeof html !== "string" || !html.trim()) {
    return json({ error: "HTML is required" }, 400);
  }

  await writeGitHubTextFile(env, {
    path: appHtmlPath(appId),
    content: html,
    message: message || `update ${appId} html by ${actor}`
  });

  const existingKv = await readGitHubJsonFile(env, appKvPath(appId));
  if (!existingKv) {
    await writeGitHubTextFile(env, {
      path: appKvPath(appId),
      content: JSON.stringify({}, null, 2) + "\n",
      message: `initialize ${appId} kv`
    });
  }

  return json({ ok: true, appId }, 200);
}

export async function handleApiGetKv(env, appId) {
  const kv = await readGitHubJsonFile(env, appKvPath(appId));
  return json({ appId, kv: kv || {} }, 200);
}

export async function handleApiPutKv(request, env, appId, actor) {
  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Request body must be a JSON object" }, 400);
  }

  await writeGitHubTextFile(env, {
    path: appKvPath(appId),
    content: JSON.stringify(body, null, 2) + "\n",
    message: `replace ${appId} kv by ${actor}`
  });

  return json({ ok: true, appId }, 200);
}

export async function handleApiDeleteApp(env, appId, actor) {
  const deletedHtml = await deleteGitHubFile(env, {
    path: appHtmlPath(appId),
    message: `delete ${appId} html by ${actor}`
  });

  const deletedKv = await deleteGitHubFile(env, {
    path: appKvPath(appId),
    message: `delete ${appId} kv by ${actor}`
  });

  if (!deletedHtml && !deletedKv) {
    return json({ error: "App not found" }, 404);
  }

  return json({ ok: true, appId, deletedHtml, deletedKv }, 200);
}

export async function handleApiRenameApp(request, env, appId, actor) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  const toAppId = body?.to;
  if (!isValidAppId(toAppId)) {
    return json({ error: "Destination app ID is invalid" }, 400);
  }

  if (toAppId === appId) {
    return json({ ok: true, fromAppId: appId, toAppId, renamed: false }, 200);
  }

  const fromHtmlPath = appHtmlPath(appId);
  const fromKvPath = appKvPath(appId);
  const toHtmlPath = appHtmlPath(toAppId);
  const toKvPath = appKvPath(toAppId);

  const fromHtml = await readGitHubTextFile(env, fromHtmlPath);
  const fromKvText = await readGitHubTextFile(env, fromKvPath);
  if (!fromHtml && !fromKvText) {
    return json({ error: "App not found" }, 404);
  }

  const toHtml = await readGitHubTextFile(env, toHtmlPath);
  const toKv = await readGitHubTextFile(env, toKvPath);
  if (toHtml || toKv) {
    return json({ error: "Destination app already exists" }, 409);
  }

  if (fromHtml) {
    await writeGitHubTextFile(env, {
      path: toHtmlPath,
      content: fromHtml,
      message: `rename ${appId} html to ${toAppId} by ${actor}`
    });
  }

  if (fromKvText) {
    await writeGitHubTextFile(env, {
      path: toKvPath,
      content: fromKvText,
      message: `rename ${appId} kv to ${toAppId} by ${actor}`
    });
  }

  if (fromHtml) {
    await deleteGitHubFile(env, {
      path: fromHtmlPath,
      message: `delete ${appId} html after rename to ${toAppId} by ${actor}`
    });
  }

  if (fromKvText) {
    await deleteGitHubFile(env, {
      path: fromKvPath,
      message: `delete ${appId} kv after rename to ${toAppId} by ${actor}`
    });
  }

  return json({ ok: true, fromAppId: appId, toAppId, renamed: true }, 200);
}

function isValidAppId(appId) {
  return typeof appId === "string" && /^[A-Za-z0-9_-]+$/.test(appId);
}
