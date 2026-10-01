/** Bytes of randomness behind a public link: 128 bits, so a link cannot be guessed or walked. */
export const PUBLIC_TOKEN_BYTES = 16;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Base64url without padding: 16 bytes become 22 URL-safe characters. */
export function encodePublicToken(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newPublicToken(): string {
  return encodePublicToken(crypto.getRandomValues(new Uint8Array(PUBLIC_TOKEN_BYTES)));
}

export function isPublicToken(value: string | null | undefined): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** The customer's tracking page for a shipped order. */
export function trackingPagePath(token: string): string {
  return `/t/${token}`;
}

/** The customer's page for printing a return label. */
export function returnLabelPagePath(token: string): string {
  return `/r/${token}`;
}

export function publicLink(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}
