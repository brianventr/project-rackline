/**
 * AES-GCM for credentials at rest: channel keys and tokens, the Shopify Admin token and webhook secret,
 * and carrier API keys, secrets, and tracker webhook secrets. The key is derived from BETTER_AUTH_SECRET
 * with HKDF, so rotating that secret makes stored credentials unreadable and the owner reconnects.
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

export function isSealed(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** SHA-256 hex of a webhook secret. Safe to store and look up; it is not enough to verify a signature. */
export async function secretFingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A stored credential in the clear. A sealed value is opened, or null when this secret cannot open it.
 * A plain value, stored before its column was sealed, reads as is, and `reseal` holds it sealed so the
 * caller can write it back.
 */
export async function readStoredSecret(
  secret: string,
  stored: string | null | undefined,
): Promise<{ value: string | null; reseal: string | null }> {
  if (!stored) return { value: null, reseal: null };
  if (isSealed(stored)) return { value: await openSecret(secret, stored), reseal: null };
  return { value: stored, reseal: await sealSecret(secret, stored) };
}

/** The only localhost fallback. Sign-in and sealed credentials must use this same value. */
export const LOCAL_DEV_SECRET = "dev-only-local-secret-do-not-use-in-prod-32ch";

export function isLocalDevUrl(url: string | null | undefined): boolean {
  const value = url ?? "";
  return value.startsWith("http://localhost") || value.startsWith("http://127.0.0.1");
}

/**
 * Deployed workers must set BETTER_AUTH_SECRET. A localhost auth URL, or a localhost request origin
 * when that URL is unset, may fall back to the same dev key sign-in uses. No other host may.
 */
export function channelSecret(env: { BETTER_AUTH_SECRET?: string; BETTER_AUTH_URL?: string }, origin?: string): string {
  const fromEnv = env.BETTER_AUTH_SECRET?.trim() ?? "";
  if (fromEnv.length >= 32) return fromEnv;
  const url = env.BETTER_AUTH_URL?.trim() || origin || "";
  if (isLocalDevUrl(url)) return LOCAL_DEV_SECRET;
  throw new Error("BETTER_AUTH_SECRET must be set (32+ characters) to store channel credentials");
}
