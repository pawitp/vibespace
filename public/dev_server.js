#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8788;

function parseArgs(argv) {
  const args = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--upstream" && next) {
      args.upstream = next;
      i += 1;
      continue;
    }
    if (arg === "--app-id" && next) {
      args.appId = next;
      i += 1;
      continue;
    }
    if (arg === "--html" && next) {
      args.htmlPath = next;
      i += 1;
      continue;
    }
    if (arg === "--token-file" && next) {
      args.tokenFile = next;
      i += 1;
      continue;
    }
    if (arg === "--host" && next) {
      args.host = next;
      i += 1;
      continue;
    }
    if (arg === "--port" && next) {
      args.port = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--help") {
      args.help = true;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  const lines = [
    "Usage:",
    "  node dev_server.js --upstream <url> --app-id <id> --html <path> --token-file <path> [--host 127.0.0.1] [--port 8788]",
    "",
    "Behavior:",
    "  - Serves local HTML at / and /apps/<app-id>",
    "  - Proxies GET/HEAD /api/assets/<asset-id> to upstream (authenticated)",
    "  - Proxies POST /api/proxy with JSON body {\"url\":\"https://...\"} to upstream (authenticated)",
    "  - Provides only /api/apps/<app-id>/kv",
    "  - Loads KV from upstream on first read per app, then keeps KV in local memory",
    "  - PUT /kv updates only local memory (no write back to upstream)"
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function readToken(tokenFile) {
  const raw = await readFile(tokenFile, "utf8");
  const token = raw.trim();
  if (!token) {
    throw new Error("Token file is empty");
  }
  return token;
}

function writeText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "content-type": contentType });
  res.end(text);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.upstream || !args.appId || !args.htmlPath || !args.tokenFile) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const upstream = new URL(args.upstream);
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    throw new Error(`Invalid port: ${args.port}`);
  }
  const kvCache = new Map();

  async function ensureKvLoaded(appId) {
    if (kvCache.has(appId)) {
      return;
    }

    const token = await readToken(args.tokenFile);
    const kvUrl = new URL(`/api/apps/${encodeURIComponent(appId)}/kv`, upstream);
    const res = await fetch(kvUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error(`Failed to load upstream KV for ${appId}: ${res.status}`);
    }

    const data = await res.json();
    const kv = data?.kv && typeof data.kv === "object" && !Array.isArray(data.kv) ? data.kv : {};
    kvCache.set(appId, kv);
  }

  const server = createServer(async (req, res) => {
    try {
      const method = req.method || "GET";
      const requestUrl = new URL(req.url || "/", `http://${args.host}:${args.port}`);
      const pathname = requestUrl.pathname;

      if (method === "GET" && (pathname === "/" || pathname === `/apps/${args.appId}`)) {
        const html = await readFile(args.htmlPath, "utf8");
        writeText(res, 200, html, "text/html; charset=utf-8");
        return;
      }

      const assetMatch = pathname.match(/^\/api\/assets\/([a-f0-9]{64})$/);
      if (assetMatch && (method === "GET" || method === "HEAD")) {
        const token = await readToken(args.tokenFile);
        const assetUrl = new URL(pathname, upstream);
        const upstreamRes = await fetch(assetUrl, {
          method,
          headers: { authorization: `Bearer ${token}` }
        });

        const responseHeaders = new Headers(upstreamRes.headers);
        responseHeaders.delete("transfer-encoding");

        if (method === "HEAD") {
          res.writeHead(upstreamRes.status, Object.fromEntries(responseHeaders.entries()));
          res.end();
          return;
        }

        const body = Buffer.from(await upstreamRes.arrayBuffer());
        res.writeHead(upstreamRes.status, Object.fromEntries(responseHeaders.entries()));
        res.end(body);
        return;
      }

      if (pathname === "/api/proxy" && method === "POST") {
        const token = await readToken(args.tokenFile);
        const upstreamProxyUrl = new URL("/api/proxy", upstream);
        const requestBody = await readRequestBody(req);
        const upstreamHeaders = { authorization: `Bearer ${token}` };
        const userAgent = req.headers["user-agent"];
        if (typeof userAgent === "string" && userAgent) {
          upstreamHeaders["user-agent"] = userAgent;
        }
        const contentType = req.headers["content-type"];
        if (typeof contentType === "string" && contentType) {
          upstreamHeaders["content-type"] = contentType;
        } else {
          upstreamHeaders["content-type"] = "application/json; charset=utf-8";
        }
        const accept = req.headers["accept"];
        if (typeof accept === "string" && accept) {
          upstreamHeaders.accept = accept;
        }
        const upstreamRes = await fetch(upstreamProxyUrl, {
          method: "POST",
          headers: upstreamHeaders,
          body: requestBody
        });

        const responseHeaders = new Headers(upstreamRes.headers);
        responseHeaders.delete("transfer-encoding");

        const responseBody = Buffer.from(await upstreamRes.arrayBuffer());
        res.writeHead(upstreamRes.status, Object.fromEntries(responseHeaders.entries()));
        res.end(responseBody);
        return;
      }

      const kvMatch = pathname.match(/^\/api\/apps\/([a-zA-Z0-9_-]+)\/kv$/);
      if (kvMatch) {
        const apiAppId = kvMatch[1];

        if (method === "GET") {
          await ensureKvLoaded(apiAppId);
          writeText(
            res,
            200,
            JSON.stringify({ appId: apiAppId, kv: kvCache.get(apiAppId) || {} }),
            "application/json; charset=utf-8"
          );
          return;
        }

        if (method === "PUT") {
          const bodyBuffer = await readRequestBody(req);
          const raw = bodyBuffer.toString("utf8");
          const parsed = raw ? JSON.parse(raw) : null;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            writeText(
              res,
              400,
              JSON.stringify({ error: "Request body must be a JSON object" }),
              "application/json; charset=utf-8"
            );
            return;
          }

          kvCache.set(apiAppId, parsed);
          writeText(res, 200, JSON.stringify({ ok: true, appId: apiAppId }), "application/json; charset=utf-8");
          return;
        }

        writeText(
          res,
          405,
          JSON.stringify({ error: "Method not allowed" }),
          "application/json; charset=utf-8"
        );
        return;
      }

      if (pathname.startsWith("/api/")) {
        writeText(
          res,
          404,
          JSON.stringify({
            error: "Only /api/apps/{appId}/kv, /api/assets/{assetId}, and /api/proxy are available in dev_server"
          }),
          "application/json; charset=utf-8"
        );
        return;
      }

      if (method === "GET" && pathname === "/health") {
        writeText(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
        return;
      }

      writeText(res, 404, "Not found");
    } catch (error) {
      writeText(res, 500, `dev_server error: ${String(error?.message || error)}`);
    }
  });

  server.listen(args.port, args.host, () => {
    process.stdout.write(`dev_server listening on http://${args.host}:${args.port}\n`);
    process.stdout.write(`Serving local app at /apps/${args.appId}\n`);
    process.stdout.write(
      "Providing local /api/apps/{appId}/kv and proxied /api/assets/{assetId} + /api/proxy\n"
    );
    process.stdout.write(`KV will be loaded from ${upstream.origin} only when cache is empty\n`);
  });
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exit(1);
});
