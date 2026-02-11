import {
  buildSessionCookie,
  clearSessionCookie,
  issueAccessToken,
  issueSignedState,
  utf8ToB64url,
  verifySignedState
} from "../lib/auth.js";
import { mustEnv } from "../lib/config.js";
import { json } from "../lib/http.js";
import { parsers, server, utils as webauthnUtils } from "@passwordless-id/webauthn";
import {
  consumeRegistrationToken,
  getPasskeyCredentialById,
  insertPasskeyCredential,
  isRegistrationTokenValid,
  listPasskeyCredentials,
  updatePasskeyCredentialUsage
} from "../lib/passkeys.js";

export async function handleLoginPage(request, env) {
  return renderAuthAsset(request, env, "/auth-login.html");
}

export async function handleRegisterPage(request, env, registrationToken) {
  if (!(await isRegistrationTokenValid(env, registrationToken))) {
    return new Response("Registration token is invalid or expired.", { status: 404 });
  }

  return renderAuthAsset(request, env, "/auth-register.html", {
    "__REGISTER_TOKEN_JSON__": JSON.stringify(String(registrationToken))
  });
}

export async function handlePasskeyLoginOptions(request, env) {
  const credentials = await listPasskeyCredentials(env);
  if (credentials.length === 0) {
    return json({ error: "No passkeys enrolled. Create a one-time token and visit /auth/register/<token>." }, 400);
  }

  const challenge = server.randomChallenge();
  const rpId = resolveRpId(env);
  const origin = resolveOrigin(env);
  const state = await issueSignedState(env, { type: "passkey_login", challenge, rpId, origin });

  return json({
    publicKey: {
      challenge,
      timeout: 60000,
      rpId,
      userVerification: "preferred",
      allowCredentials: credentials.map((credential) => ({
        type: "public-key",
        id: credential.id,
        transports: Array.isArray(credential.transports) ? credential.transports : []
      }))
    },
    state
  });
}

export async function handlePasskeyLoginVerify(request, env) {
  const body = await readJsonBody(request);
  const state = await verifySignedState(env, body?.state, "passkey_login");
  if (!state) {
    return json({ error: "Invalid login state" }, 400);
  }

  const credential = body?.credential;
  if (!credential || credential.type !== "public-key") {
    return json({ error: "Invalid credential payload" }, 400);
  }

  const stored = await getPasskeyCredentialById(env, credential.id);
  if (!stored) {
    return json({ error: "Credential not enrolled" }, 403);
  }

  let authInfo;
  try {
    authInfo = await server.verifyAuthentication(
      credential,
      {
        id: stored.id,
        publicKey: stored.publicKey,
        algorithm: stored.algorithm
      },
      {
        challenge: state.challenge,
        origin: state.origin,
        domain: state.rpId,
        userVerified: false,
        counter: Number(stored.counter || 0)
      }
    );
  } catch (error) {
    return json({ error: String(error?.message || error || "Authentication verification failed") }, 403);
  }

  await updatePasskeyCredentialUsage(env, stored.id, authInfo.counter, new Date().toISOString());

  const token = await issueAccessToken(env, { sub: ownerSub(env), amr: "passkey" });
  const expiresIn = Number(env.TOKEN_TTL_SECONDS || "86400");
  const sessionCookie = buildSessionCookie(token, expiresIn);

  return json(
    { ok: true, sub: ownerSub(env), userVerified: !!authInfo.userVerified },
    200,
    { "set-cookie": sessionCookie }
  );
}

export async function handlePasskeyRegisterOptions(request, env) {
  const payload = await readJsonBody(request);
  const registrationToken = String(payload?.token || "").trim();
  if (!registrationToken) {
    return json({ error: "Registration token is required" }, 400);
  }
  if (!(await isRegistrationTokenValid(env, registrationToken))) {
    return json({ error: "Registration token is invalid or expired" }, 404);
  }

  const credentials = await listPasskeyCredentials(env);
  const challenge = server.randomChallenge();
  const rpId = resolveRpId(env);
  const origin = resolveOrigin(env);
  const label = typeof payload?.label === "string" ? payload.label.trim() : "";
  const state = await issueSignedState(env, {
    type: "passkey_register",
    challenge,
    rpId,
    origin,
    label,
    registrationToken
  });
  const sub = ownerSub(env);

  return json({
    publicKey: {
      challenge,
      rp: { name: "vibespace", id: rpId },
      user: { id: utf8ToB64url(sub), name: sub, displayName: sub },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 }
      ],
      timeout: 60000,
      attestation: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred"
      },
      excludeCredentials: credentials.map((credential) => ({
        type: "public-key",
        id: credential.id,
        transports: Array.isArray(credential.transports) ? credential.transports : []
      }))
    },
    state
  });
}

export async function handlePasskeyRegisterVerify(request, env) {
  const body = await readJsonBody(request);
  const state = await verifySignedState(env, body?.state, "passkey_register");
  if (!state) {
    return json({ error: "Invalid registration state" }, 400);
  }

  const credential = body?.credential;
  if (!credential || credential.type !== "public-key") {
    return json({ error: "Invalid credential payload" }, 400);
  }

  if (!credential.response?.authenticatorData) {
    return json({ error: "Missing authenticatorData. Use a modern browser for registration." }, 400);
  }
  if (!credential.response?.publicKey) {
    return json({ error: "Missing public key from authenticator response." }, 400);
  }

  let registrationInfo;
  try {
    registrationInfo = await server.verifyRegistration(
      {
        ...credential,
        clientExtensionResults: credential.clientExtensionResults || {},
        user: {
          id: utf8ToB64url(ownerSub(env)),
          name: ownerSub(env),
          displayName: ownerSub(env)
        }
      },
      {
        challenge: state.challenge,
        origin: state.origin
      }
    );
  } catch (error) {
    return json({ error: String(error?.message || error || "Registration verification failed") }, 400);
  }

  const rpOk = await verifyRpIdHash(credential.response.authenticatorData, state.rpId);
  if (!rpOk) {
    return json({ error: "RP ID mismatch" }, 400);
  }

  const existing = await getPasskeyCredentialById(env, credential.id);
  if (!(await consumeRegistrationToken(env, state.registrationToken))) {
    return json({ error: "Registration token is invalid, used, or expired" }, 409);
  }

  if (existing) {
    return json({ ok: true, alreadyExists: true, tokenConsumed: true });
  }

  await insertPasskeyCredential(env, {
    id: credential.id,
    publicKey: registrationInfo.credential.publicKey,
    algorithm: registrationInfo.credential.algorithm,
    transports: Array.isArray(registrationInfo.credential.transports) ? registrationInfo.credential.transports : [],
    label: state.label || "",
    counter: Number(registrationInfo.authenticator.counter || 0),
    createdAt: new Date().toISOString(),
    lastUsedAt: null
  });

  return json({ ok: true, credentialId: credential.id, tokenConsumed: true });
}

export function handleLogout(request) {
  const redirect = new URL("/auth/login", request.url);
  return new Response(null, {
    status: 302,
    headers: {
      location: redirect.toString(),
      "set-cookie": clearSessionCookie()
    }
  });
}

export async function handleTokenIssue(env, claims) {
  const token = await issueAccessToken(env, { sub: claims.sub });
  const expiresIn = Number(env.TOKEN_TTL_SECONDS || "86400");
  return json(
    { token, expiresIn, type: "Bearer" },
    200,
    {
      "cache-control": "no-store, private",
      pragma: "no-cache"
    }
  );
}

function ownerSub(env) {
  return mustEnv(env, "PASSKEY_OWNER_SUB");
}

function resolveRpId(env) {
  return mustEnv(env, "PASSKEY_RP_ID");
}

function resolveOrigin(env) {
  return mustEnv(env, "PASSKEY_ORIGIN");
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function renderAuthAsset(request, env, path, replacements) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return json({ error: "ASSETS binding is not configured" }, 500);
  }

  const assetUrl = new URL(path, request.url);
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
  if (!assetResponse.ok) {
    return json({ error: `${path} not found` }, 404);
  }

  let html = await assetResponse.text();
  for (const [key, value] of Object.entries(replacements || {})) {
    html = html.split(key).join(String(value));
  }

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function verifyRpIdHash(authenticatorDataB64url, rpId) {
  const parsed = parsers.parseAuthenticator(authenticatorDataB64url);
  const expected = webauthnUtils.toBase64url(await webauthnUtils.sha256(webauthnUtils.toBuffer(String(rpId))));
  return parsed.rpIdHash === expected;
}
