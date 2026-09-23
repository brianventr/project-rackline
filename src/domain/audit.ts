const SKIP_PREFIXES = [
  "/api/auth",
  "/api/demo/seed",
  "/api/shopify/webhooks",
  "/api/shopify/fulfillment_order_notification",
  "/api/shopify/oauth/callback",
  "/api/carriers/trackers/webhooks",
];

const SECRET_KEYS = [
  "password",
  "newpassword",
  "token",
  "secret",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "webhooksecret",
  "clientsecret",
  "meternumber",
  "authorization",
];

export function isAuditSkippedPath(path: string): boolean {
  const bare = path.split("?")[0] ?? path;
  return SKIP_PREFIXES.some((prefix) => bare === prefix || bare.startsWith(`${prefix}/`));
}

export function shouldAudit(input: { method: string; path: string; status: number }): boolean {
  if (isAuditSkippedPath(input.path)) return false;
  const method = input.method.toUpperCase();
  const mutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (mutating) return true;
  return input.status === 409 || input.status === 403;
}

export function auditAction(method: string, status: number): string {
  if (status === 409) return "http.conflict";
  if (status === 403) return "http.forbidden";
  return `http.${method.toLowerCase()}`;
}

export function auditSummary(input: { method: string; path: string; status: number; code?: string | null }): string {
  const verb = input.method.toUpperCase();
  const code = input.code ? ` ${input.code}` : "";
  return `${verb} ${input.path} → ${input.status}${code}`;
}

function isSecretKey(key: string): boolean {
  const compact = key.replace(/[_-]/g, "").toLowerCase();
  return SECRET_KEYS.some((secret) => compact === secret || compact.endsWith(secret));
}

export function redactAuditPayload(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((row) => redactAuditPayload(row, depth + 1));
  }
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? "[redacted]" : redactAuditPayload(entry, depth + 1);
  }
  return out;
}

export function serializeAuditPayload(value: unknown): string | null {
  if (value == null) return null;
  try {
    const json = JSON.stringify(redactAuditPayload(value));
    if (!json || json === "{}" || json === "null") return null;
    return json.length > 2000 ? `${json.slice(0, 1999)}…` : json;
  } catch {
    return null;
  }
}

export function codeFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

/**
 * A sign-in is audited too. `/api/auth` is skipped by the request audit above, so better-auth's
 * session hook (`createAuth`) writes this row instead. It is what lets the Team list see someone
 * who signed in, only looked things up, and signed out: sign-out deletes the session row, and an
 * audit row outlives it.
 */
export const SIGN_IN_CODE = "SIGNED_IN";
export const SIGN_IN_ACTION = "auth.sign_in";

export type SignInAudit = {
  action: string;
  method: string;
  path: string;
  status: number;
  code: string;
  summary: string;
};

/** The fixed audit fields for a sign-in. `endpointPath` is better-auth's own path, e.g. "/sign-in/email". */
export function signInAudit(endpointPath: unknown): SignInAudit {
  const path =
    typeof endpointPath === "string" && /^\/[\w\-/]*$/.test(endpointPath) ? `/api/auth${endpointPath}` : "/api/auth/sign-in";
  return { action: SIGN_IN_ACTION, method: "POST", path, status: 200, code: SIGN_IN_CODE, summary: "Signed in" };
}
