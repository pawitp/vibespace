const BASE64URL_PAD = "===";

export function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToBytes(base64) {
  const clean = String(base64).replace(/\n/g, "");
  const binary = atob(clean);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function textToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(String(text)));
}

export function base64ToText(base64) {
  return new TextDecoder().decode(base64ToBytes(base64));
}

export function bytesToBase64url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function textToBase64url(text) {
  return bytesToBase64url(new TextEncoder().encode(String(text)));
}

export function base64urlToBytes(base64url) {
  const normalized = String(base64url).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + BASE64URL_PAD.slice((normalized.length + 3) % 4);
  return base64ToBytes(padded);
}
