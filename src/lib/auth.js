import { sign as jwtSign, verify as jwtVerify } from "@tsndr/cloudflare-worker-jwt";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import { textToBase64url } from "./base64.js";
import { mustEnv } from "./config.js";
import { json } from "./http.js";

const SESSION_COOKIE_NAME = "vibespace_session";

export async function requireAuth(request, env, options) {
  const authz = request.headers.get("authorization") || "";
  let token = "";
  if (authz.startsWith("Bearer ")) {
    token = authz.slice("Bearer ".length).trim();
  } else {
    token = readCookie(request, SESSION_COOKIE_NAME) || "";
  }

  if (!token) {
    return { ok: false, response: unauthenticatedResponse(request, options) };
  }

  const claims = await verifyAccessToken(env, token);
  if (!claims) {
    return { ok: false, response: unauthenticatedResponse(request, options) };
  }

  return { ok: true, claims };
}

function unauthenticatedResponse(request, options) {
  if (options.api) {
    return json({ error: "Authentication required" }, 401);
  }

  const loginUrl = new URL("/auth/login", request.url);
  const requestUrl = new URL(request.url);
  const returnTo = `${requestUrl.pathname}${requestUrl.search}`;
  if (returnTo && returnTo !== "/auth/login") {
    loginUrl.searchParams.set("returnTo", returnTo);
  }
  return Response.redirect(loginUrl.toString(), 302);
}

export async function issueAccessToken(env, claims) {
  const iat = Math.floor(Date.now() / 1000);
  const ttl = Number(env.TOKEN_TTL_SECONDS || "86400");
  const payload = { ...claims, type: "access", iat, exp: iat + ttl };
  return signBlob(payload, env);
}

async function verifyAccessToken(env, token) {
  const payload = await verifyBlob(token, env);
  if (!payload) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || now > payload.exp) {
    return null;
  }

  if (payload.type !== "access") {
    return null;
  }

  if (typeof payload.sub !== "string" || !payload.sub.trim()) {
    return null;
  }

  return payload;
}

export async function issueSignedState(env, data, ttlSeconds = 300) {
  const now = Math.floor(Date.now() / 1000);
  return signBlob({ ...data, iat: now, exp: now + Math.max(10, Number(ttlSeconds) || 300) }, env);
}

export async function verifySignedState(env, token, expectedType) {
  const payload = await verifyBlob(token, env);
  if (!payload) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || now > payload.exp) {
    return null;
  }

  if (expectedType && payload.type !== expectedType) {
    return null;
  }

  return payload;
}

async function signBlob(payload, env) {
  return jwtSign(payload, mustEnv(env, "SESSION_SECRET"), "HS256");
}

async function verifyBlob(token, env) {
  if (!token) {
    return null;
  }

  try {
    const verified = await jwtVerify(token, mustEnv(env, "SESSION_SECRET"), "HS256");
    return verified?.payload || null;
  } catch {
    return null;
  }
}

export function utf8ToB64url(input) {
  return textToBase64url(input);
}

function readCookie(request, key) {
  const raw = request.headers.get("cookie") || "";
  if (!raw) {
    return null;
  }
  const parsed = parseCookie(raw);
  return parsed[key] || null;
}

export function buildSessionCookie(token, ttlSeconds) {
  const maxAge = Math.max(1, Number(ttlSeconds) || 86400);
  return serializeCookie(SESSION_COOKIE_NAME, token, {
    path: "/",
    maxAge,
    httpOnly: true,
    secure: true,
    sameSite: "lax"
  });
}

export function clearSessionCookie() {
  return serializeCookie(SESSION_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: "lax"
  });
}
