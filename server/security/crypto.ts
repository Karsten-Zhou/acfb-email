// AES-GCM authenticated encryption for stored email credentials.
//
// Threat model:
//   - Protects against a read of the D1 database (e.g. backup leak, DB dump).
//   - The key is held in a Cloudflare secret (CREDENTIAL_ENCRYPTION_KEY), never
//     in source or the DB.
//   - Does NOT protect against compromise of the Worker runtime itself, since
//     the key is available to the Worker at runtime. If the Worker is fully
//     compromised, the attacker can decrypt. This is inherent to server-side
//     encryption and documented in SECURITY.md.
//
// Format of stored credential strings:
//   v1:<base64(iv)>.<base64(ciphertext+authTag)>

const VERSION = "v1";

function toBytes(keyHex: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(keyHex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export async function encryptCredential(plaintext: string, keyHex: string): Promise<string> {
  const rawKey = await crypto.subtle.importKey("raw", toBytes(keyHex), { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    rawKey,
    new TextEncoder().encode(plaintext),
  );
  const ctBytes = new Uint8Array(ct);
  // iv . ciphertext(authTag appended by AES-GCM)
  return `${VERSION}:${bytesToBase64(iv)}.${bytesToBase64(ctBytes)}`;
}

export async function decryptCredential(stored: string, keyHex: string): Promise<string> {
  const [version, rest] = stored.split(":");
  if (version !== VERSION || !rest || !rest.includes(".")) {
    throw new Error("Unsupported credential blob format");
  }
  const [ivB64, dataB64] = rest.split(".");
  const rawKey = await crypto.subtle.importKey("raw", toBytes(keyHex), { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivB64) },
    rawKey,
    base64ToBytes(dataB64),
  );
  return new TextDecoder().decode(pt);
}
