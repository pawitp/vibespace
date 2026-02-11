import { json } from "../lib/http.js";

const PRIVATE_IPV4_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./
];

const PRIVATE_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

export async function handleApiProxy(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  const rawTarget = body?.url;
  if (typeof rawTarget !== "string" || !rawTarget.trim()) {
    return json({ error: "Missing url in JSON body" }, 400);
  }

  let targetUrl;
  try {
    targetUrl = new URL(rawTarget);
  } catch {
    return json({ error: "Invalid url query parameter" }, 400);
  }

  if (!isAllowedProtocol(targetUrl.protocol)) {
    return json({ error: "Only https URLs are allowed" }, 400);
  }

  if (isPrivateHost(targetUrl.hostname)) {
    return json({ error: "Private and localhost targets are not allowed" }, 400);
  }

  const upstreamHeaders = new Headers();
  const accept = request.headers.get("accept");
  if (accept) {
    upstreamHeaders.set("accept", accept);
  } else {
    upstreamHeaders.set("accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8");
  }
  const userAgent = request.headers.get("user-agent");
  if (userAgent) {
    upstreamHeaders.set("user-agent", userAgent);
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: upstreamHeaders,
      redirect: "follow"
    });
  } catch (error) {
    return json({ error: "Failed to fetch target URL", detail: String(error?.message || error) }, 502);
  }

  const responseHeaders = new Headers();
  copyHeaderIfPresent(upstreamResponse.headers, responseHeaders, "content-type");
  copyHeaderIfPresent(upstreamResponse.headers, responseHeaders, "cache-control");
  copyHeaderIfPresent(upstreamResponse.headers, responseHeaders, "etag");
  copyHeaderIfPresent(upstreamResponse.headers, responseHeaders, "last-modified");
  responseHeaders.set("x-vibespace-proxy-url", targetUrl.toString());

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders
  });
}

function isAllowedProtocol(protocol) {
  return protocol === "https:";
}

function isPrivateHost(hostname) {
  const lower = String(hostname || "").toLowerCase();
  if (!lower) {
    return true;
  }

  if (PRIVATE_HOSTNAMES.has(lower) || lower.endsWith(".localhost")) {
    return true;
  }

  for (const pattern of PRIVATE_IPV4_PATTERNS) {
    if (pattern.test(lower)) {
      return true;
    }
  }

  if (lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }

  return false;
}

function copyHeaderIfPresent(from, to, name) {
  const value = from.get(name);
  if (value) {
    to.set(name, value);
  }
}
