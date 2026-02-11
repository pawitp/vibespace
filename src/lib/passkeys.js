function db(env) {
  if (!env.PASSKEYS_DB || typeof env.PASSKEYS_DB.prepare !== "function") {
    throw new Error("PASSKEYS_DB D1 binding is not configured");
  }
  return env.PASSKEYS_DB;
}

export async function listPasskeyCredentials(env) {
  db(env);
  const result = await db(env)
    .prepare(
      `SELECT id, public_key, algorithm, counter, label, transports_json, created_at, last_used_at
       FROM passkey_credentials
       ORDER BY created_at ASC`
    )
    .all();
  return (result.results || []).map(rowToCredential);
}

export async function getPasskeyCredentialById(env, credentialId) {
  db(env);
  const row = await db(env)
    .prepare(
      `SELECT id, public_key, algorithm, counter, label, transports_json, created_at, last_used_at
       FROM passkey_credentials
       WHERE id = ?1`
    )
    .bind(String(credentialId))
    .first();
  return row ? rowToCredential(row) : null;
}

export async function insertPasskeyCredential(env, credential) {
  db(env);
  await db(env)
    .prepare(
      `INSERT INTO passkey_credentials
       (id, public_key, algorithm, counter, label, transports_json, created_at, last_used_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
    .bind(
      credential.id,
      credential.publicKey,
      normalizeAlgorithm(credential.algorithm),
      Number(credential.counter || 0),
      String(credential.label || ""),
      JSON.stringify(Array.isArray(credential.transports) ? credential.transports : []),
      String(credential.createdAt || new Date().toISOString()),
      credential.lastUsedAt ? String(credential.lastUsedAt) : null
    )
    .run();
}

export async function updatePasskeyCredentialUsage(env, credentialId, counter, lastUsedAt) {
  db(env);
  await db(env)
    .prepare(`UPDATE passkey_credentials SET counter = ?2, last_used_at = ?3 WHERE id = ?1`)
    .bind(String(credentialId), Number(counter || 0), String(lastUsedAt || new Date().toISOString()))
    .run();
}

export async function deletePasskeyCredential(env, credentialId) {
  db(env);
  const result = await db(env)
    .prepare("DELETE FROM passkey_credentials WHERE id = ?1")
    .bind(String(credentialId))
    .run();
  return Number(result.meta?.changes || 0);
}

export async function resetPasskeyCredentials(env) {
  db(env);
  await db(env).prepare("DELETE FROM passkey_credentials").run();
}

export async function isRegistrationTokenValid(env, token) {
  db(env);
  const row = await db(env)
    .prepare(
      `SELECT token
       FROM registration_tokens
       WHERE token = ?1
         AND used_at IS NULL
         AND datetime(expires_at) > datetime('now')`
    )
    .bind(String(token))
    .first();
  return !!row;
}

export async function consumeRegistrationToken(env, token) {
  db(env);
  const result = await db(env)
    .prepare(
      `UPDATE registration_tokens
       SET used_at = datetime('now')
       WHERE token = ?1
         AND used_at IS NULL
         AND datetime(expires_at) > datetime('now')`
    )
    .bind(String(token))
    .run();
  return Number(result.meta?.changes || 0) === 1;
}

export function sanitizeCredential(credential) {
  return {
    id: credential.id,
    algorithm: credential.algorithm,
    counter: Number(credential.counter || 0),
    label: credential.label || "",
    createdAt: credential.createdAt || null,
    lastUsedAt: credential.lastUsedAt || null,
    transports: Array.isArray(credential.transports) ? credential.transports : []
  };
}

function rowToCredential(row) {
  let transports = [];
  try {
    const parsed = JSON.parse(row.transports_json || "[]");
    transports = Array.isArray(parsed) ? parsed : [];
  } catch {
    transports = [];
  }
  return {
    id: row.id,
    publicKey: row.public_key,
    algorithm: normalizeAlgorithm(row.algorithm),
    counter: Number(row.counter || 0),
    label: row.label || "",
    transports,
    createdAt: row.created_at || null,
    lastUsedAt: row.last_used_at || null
  };
}

function normalizeAlgorithm(value) {
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (normalized === "ES256" || normalized === "RS256") {
      return normalized;
    }
  }

  return "ES256";
}
