/**
 * AES-GCM for channel credentials at rest. The key is derived from BETTER_AUTH_SECRET with HKDF,
 * so rotating that secret makes stored channel tokens unreadable and the owner reconnects.
 */
const PREFIX = "sb1:";
const INFO = new TextEncoder().encode("rackline-channel-credentials");

async function keyFrom(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(16), info: INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export async function sealSecret(secret: string, value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(secret), new TextEncoder().encode(value));
  const packed = new Uint8Array(iv.length + cipher.byteLength);
  packed.set(iv);
  packed.set(new Uint8Array(cipher), iv.length);
  return PREFIX + toBase64(packed);
}

/** Returns null when the value is missing or cannot be opened with this secret. */
export async function openSecret(secret: string, sealed: string | null | undefined): Promise<string | null> {
  if (!sealed?.startsWith(PREFIX)) return null;
  try {
    const packed = fromBase64(sealed.slice(PREFIX.length));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: packed.slice(0, 12) },
      await keyFrom(secret),
      packed.slice(12),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** Deployed workers must set BETTER_AUTH_SECRET; only a localhost auth URL may fall back to a dev key. */
export function channelSecret(env: { BETTER_AUTH_SECRET?: string; BETTER_AUTH_URL?: string }): string {
  const fromEnv = env.BETTER_AUTH_SECRET?.trim() ?? "";
  if (fromEnv.length >= 32) return fromEnv;
  const url = env.BETTER_AUTH_URL ?? "";
  if (url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1")) return "rackline-local-dev-channel-secret";
  throw new Error("BETTER_AUTH_SECRET must be set (32+ characters) to store channel credentials");
}
