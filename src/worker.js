import { requireAuth } from "./lib/auth.js";
import { json } from "./lib/http.js";
import { handleApiGetAsset, handleApiPutAsset } from "./routes/assets.js";
import { handleAgentTemplate, handleDevServerScript, handleIndex } from "./routes/static.js";
import {
  handleLoginPage,
  handleLogout,
  handlePasskeyLoginOptions,
  handlePasskeyLoginVerify,
  handlePasskeyRegisterOptions,
  handlePasskeyRegisterVerify,
  handleRegisterPage,
  handleTokenIssue
} from "./routes/auth.js";
import {
  handleApiDeleteApp,
  handleApiGetHtml,
  handleApiGetKv,
  handleApiListApps,
  handleApiPutHtml,
  handleApiPutKv,
  handleApiRenameApp,
  handleAppPage
} from "./routes/apps.js";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const isAuthPath = path.startsWith("/auth");
      const isHealthPath = path === "/health";
      const isApiPath = path.startsWith("/api/");
      let auth;

      if (!isAuthPath && !isHealthPath) {
        auth = await requireAuth(request, env, { api: isApiPath });
        if (!auth.ok) {
          return withSecurityHeaders(request, auth.response);
        }
      }

      if (path === "/health") {
        return withSecurityHeaders(request, json({ ok: true, service: "vibespace", date: new Date().toISOString() }));
      }

      if (path === "/auth/login" && request.method === "GET") {
        return withSecurityHeaders(request, await handleLoginPage(request, env));
      }

      if (path === "/auth/logout" && request.method === "GET") {
        return withSecurityHeaders(request, handleLogout(request));
      }

      const registerPageMatch = path.match(/^\/auth\/register\/([A-Za-z0-9_-]{24,256})$/);
      if (registerPageMatch && request.method === "GET") {
        return withSecurityHeaders(request, await handleRegisterPage(request, env, registerPageMatch[1]));
      }

      if (path === "/auth/passkey/login/options" && request.method === "POST") {
        return withSecurityHeaders(request, await handlePasskeyLoginOptions(request, env));
      }

      if (path === "/auth/passkey/login/verify" && request.method === "POST") {
        return withSecurityHeaders(request, await handlePasskeyLoginVerify(request, env));
      }

      if (path === "/auth/passkey/register/options" && request.method === "POST") {
        return withSecurityHeaders(request, await handlePasskeyRegisterOptions(request, env));
      }

      if (path === "/auth/passkey/register/verify" && request.method === "POST") {
        return withSecurityHeaders(request, await handlePasskeyRegisterVerify(request, env));
      }

      if (path === "/auth/token" && request.method === "GET") {
        const auth = await requireAuth(request, env, { api: false });
        if (!auth.ok) {
          return withSecurityHeaders(request, auth.response);
        }
        return withSecurityHeaders(request, await handleTokenIssue(env, auth.claims));
      }

      if ((path === "/" || path === "/index.html") && request.method === "GET") {
        return withSecurityHeaders(request, await handleIndex(request, env));
      }

      if (path === "/agent-template" && request.method === "GET") {
        return withSecurityHeaders(request, await handleAgentTemplate(request, env));
      }

      if (path === "/dev_server.js" && request.method === "GET") {
        return withSecurityHeaders(request, await handleDevServerScript(request, env));
      }

      const appPageMatch = path.match(/^\/apps\/([a-zA-Z0-9_-]+)$/);
      if (appPageMatch && request.method === "GET") {
        return withSecurityHeaders(request, await handleAppPage(env, appPageMatch[1]));
      }

      if (path.startsWith("/api/")) {
        if (request.method === "PUT" && path === "/api/assets") {
          return withSecurityHeaders(request, await handleApiPutAsset(request, env));
        }

        const assetReadMatch = path.match(/^\/api\/assets\/([a-f0-9]{64})$/);
        if (assetReadMatch && (request.method === "GET" || request.method === "HEAD")) {
          return withSecurityHeaders(request, await handleApiGetAsset(env, assetReadMatch[1], request.method));
        }

        if (request.method === "GET" && path === "/api/apps") {
          return withSecurityHeaders(request, await handleApiListApps(env));
        }

        const appHtmlMatch = path.match(/^\/api\/apps\/([a-zA-Z0-9_-]+)\/html$/);
        if (appHtmlMatch && request.method === "GET") {
          return withSecurityHeaders(request, await handleApiGetHtml(env, appHtmlMatch[1]));
        }
        if (appHtmlMatch && request.method === "PUT") {
          return withSecurityHeaders(request, await handleApiPutHtml(request, env, appHtmlMatch[1], auth.claims.sub));
        }

        const appKvMatch = path.match(/^\/api\/apps\/([a-zA-Z0-9_-]+)\/kv$/);
        if (appKvMatch && request.method === "GET") {
          return withSecurityHeaders(request, await handleApiGetKv(env, appKvMatch[1]));
        }
        if (appKvMatch && request.method === "PUT") {
          return withSecurityHeaders(request, await handleApiPutKv(request, env, appKvMatch[1], auth.claims.sub));
        }

        const appDeleteMatch = path.match(/^\/api\/apps\/([a-zA-Z0-9_-]+)$/);
        if (appDeleteMatch && request.method === "DELETE") {
          return withSecurityHeaders(request, await handleApiDeleteApp(env, appDeleteMatch[1], auth.claims.sub));
        }

        const appRenameMatch = path.match(/^\/api\/apps\/([a-zA-Z0-9_-]+)\/rename$/);
        if (appRenameMatch && request.method === "POST") {
          return withSecurityHeaders(
            request,
            await handleApiRenameApp(request, env, appRenameMatch[1], auth.claims.sub)
          );
        }
      }

      return withSecurityHeaders(request, json({ error: "Not found" }, 404));
    } catch (error) {
      console.error("Unhandled worker error", error);
      return withSecurityHeaders(request, json({ error: "Internal error" }, 500));
    }
  }
};

function withSecurityHeaders(request, response) {
  const url = new URL(request.url);
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");

  if (url.protocol === "https:") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }

  const contentType = (headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) {
    if (url.pathname.startsWith("/apps/")) {
      headers.set(
        "content-security-policy",
        "default-src * data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src-elem * 'unsafe-inline' data: blob:; style-src * 'unsafe-inline'; connect-src *; img-src * data: blob:; font-src * data:; frame-src *; media-src *; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action *"
      );
    } else {
      headers.set(
        "content-security-policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
      );
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
