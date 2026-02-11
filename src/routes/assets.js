import { json } from "../lib/http.js";

export const AGENT_FILENAME = "AGENTS.md";
export const DEV_SERVER_FILENAME = "dev_server.js";

export async function handleIndex(request, env) {
  return fetchPublicAsset(request, env, "/index.html");
}

export async function handleAgentTemplate(request, env) {
  const assetResponse = await fetchPublicAsset(request, env, `/${AGENT_FILENAME}`);
  if (!assetResponse.ok) {
    return assetResponse;
  }

  const headers = new Headers(assetResponse.headers);
  headers.set("content-disposition", `inline; filename="${AGENT_FILENAME}"`);
  if (!headers.get("content-type")) {
    headers.set("content-type", "text/markdown; charset=utf-8");
  }

  return new Response(assetResponse.body, {
    status: assetResponse.status,
    headers
  });
}

export async function handleDevServerScript(request, env) {
  return fetchPublicAsset(request, env, `/${DEV_SERVER_FILENAME}`);
}

async function fetchPublicAsset(request, env, pathname) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return json({ error: "ASSETS binding is not configured" }, 500);
  }

  const assetUrl = new URL(pathname, request.url);
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
  if (!assetResponse.ok) {
    return json({ error: `${pathname} not found` }, 404);
  }
  return assetResponse;
}
