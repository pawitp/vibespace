import { json } from "../lib/http.js";

const ALLOWED_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp"
]);

const HASH_HEX_RE = /^[a-f0-9]{64}$/;

export async function handleApiPutAsset(request, env) {
  if (!env.ASSET_BLOBS || typeof env.ASSET_BLOBS.get !== "function" || typeof env.ASSET_BLOBS.put !== "function") {
    return json({ error: "ASSET_BLOBS binding is not configured" }, 500);
  }

  const normalizedContentType = normalizeContentType(request.headers.get("content-type"));
  if (!normalizedContentType || !ALLOWED_CONTENT_TYPES.has(normalizedContentType)) {
    return json(
      {
        error: "Unsupported content-type",
        allowedContentTypes: Array.from(ALLOWED_CONTENT_TYPES)
      },
      415
    );
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength) {
    return json({ error: "Asset body is required" }, 400);
  }

  const hash = await sha256Hex(bytes);
  const key = hash;

  const existing = await env.ASSET_BLOBS.head(key);
  let storedContentType = normalizedContentType;
  if (!existing) {
    await env.ASSET_BLOBS.put(key, bytes, {
      httpMetadata: {
        contentType: normalizedContentType
      }
    });
  } else if (existing.httpMetadata?.contentType) {
    storedContentType = existing.httpMetadata.contentType;
  }

  return json(
    {
      ok: true,
      assetId: hash,
      contentType: storedContentType,
      path: `/api/assets/${hash}`
    },
    200
  );
}

export async function handleApiGetAsset(env, assetId, method = "GET") {
  if (!HASH_HEX_RE.test(assetId)) {
    return json({ error: "Invalid asset ID" }, 400);
  }

  if (!env.ASSET_BLOBS || typeof env.ASSET_BLOBS.get !== "function") {
    return json({ error: "ASSET_BLOBS binding is not configured" }, 500);
  }

  const object = await env.ASSET_BLOBS.get(assetId);
  if (!object) {
    return json({ error: "Asset not found" }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", `"${assetId}"`);
  if (!headers.get("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }
  headers.set("cache-control", "private, max-age=31536000, immutable");

  if (method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(object.body, {
    status: 200,
    headers
  });
}

function normalizeContentType(value) {
  if (!value) {
    return "";
  }
  return String(value).split(";")[0].trim().toLowerCase();
}

async function sha256Hex(bytes) {
  const digestBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const digestBytes = new Uint8Array(digestBuffer);
  let hex = "";
  for (const byte of digestBytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
