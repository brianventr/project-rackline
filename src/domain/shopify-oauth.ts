import { normalizeShopDomain } from "./shopify";

export type OAuthState = {
  organizationId: string;
  shop: string;
  exp: number;
};

export function assertOauthShop(shop: string): string {
  const domain = normalizeShopDomain(shop);
  if (!domain.endsWith(".myshopify.com")) {
    throw new Error("Shopify OAuth needs a myshopify.com shop domain");
  }
  return domain;
}

export function shopifyAuthorizeUrl(input: {
  shop: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
}): string {
  const url = new URL(`https://${input.shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", input.scopes.join(","));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function shopifyOAuthMessage(params: URLSearchParams): string {
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hmac" || key === "signature") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  return pairs.join("&");
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function encodeStateBody(state: OAuthState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeStateBody(body: string): OAuthState {
  const padded = body.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(body.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<OAuthState>;
  if (!parsed.organizationId || !parsed.shop || typeof parsed.exp !== "number") {
    throw new Error("OAuth state was rejected");
  }
  return { organizationId: parsed.organizationId, shop: parsed.shop, exp: parsed.exp };
}

export async function signOAuthState(secret: string, state: OAuthState): Promise<string> {
  const body = encodeStateBody(state);
  const sig = await hmacHex(secret, body);
  return `${body}.${sig}`;
}

export async function verifyOAuthState(secret: string, token: string): Promise<OAuthState> {
  const split = token.lastIndexOf(".");
  if (split <= 0) throw new Error("OAuth state was rejected");
  const body = token.slice(0, split);
  const sig = token.slice(split + 1);
  const expected = await hmacHex(secret, body);
  if (!safeEqual(sig, expected)) throw new Error("OAuth state was rejected");
  const state = decodeStateBody(body);
  if (state.exp < Date.now()) throw new Error("OAuth state expired");
  return state;
}

export async function verifyShopifyOAuthHmac(params: URLSearchParams, secret: string): Promise<boolean> {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const expected = await hmacHex(secret, shopifyOAuthMessage(params));
  return safeEqual(hmac, expected);
}
