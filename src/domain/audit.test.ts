import { describe, expect, it } from "vitest";
import {
  auditAction,
  auditSummary,
  codeFromBody,
  redactAuditPayload,
  serializeAuditPayload,
  shouldAudit,
  SIGN_IN_ACTION,
  SIGN_IN_CODE,
  signInAudit,
} from "./audit";

describe("audit", () => {
  it("logs mutations and 409s, not reads or webhooks", () => {
    expect(shouldAudit({ method: "POST", path: "/api/adjustments", status: 200 })).toBe(true);
    expect(shouldAudit({ method: "GET", path: "/api/items", status: 200 })).toBe(false);
    expect(shouldAudit({ method: "GET", path: "/api/orders/o1/pick", status: 409 })).toBe(true);
    expect(shouldAudit({ method: "POST", path: "/api/auth/sign-in/email", status: 200 })).toBe(false);
    expect(shouldAudit({ method: "POST", path: "/api/shopify/webhooks", status: 200 })).toBe(false);
    expect(shouldAudit({ method: "DELETE", path: "/api/team/u1", status: 403 })).toBe(true);
  });

  it("redacts secrets and names the 409", () => {
    expect(redactAuditPayload({ email: "maya@shop", password: "secret", webhookSecret: "whsec" })).toEqual({
      email: "maya@shop",
      password: "[redacted]",
      webhookSecret: "[redacted]",
    });
    expect(auditAction("POST", 409)).toBe("http.conflict");
    expect(auditSummary({ method: "POST", path: "/api/adjustments", status: 409, code: "HELD_STOCK" })).toBe(
      "POST /api/adjustments → 409 HELD_STOCK",
    );
    expect(codeFromBody({ error: "held", code: "HELD_STOCK" })).toBe("HELD_STOCK");
    expect(serializeAuditPayload({ password: "x", sku: "LED-BULB" })).toBe(
      JSON.stringify({ password: "[redacted]", sku: "LED-BULB" }),
    );
  });
});

describe("signInAudit", () => {
  it("records a sign-in against better-auth's endpoint", () => {
    expect(signInAudit("/sign-in/email")).toEqual({
      action: SIGN_IN_ACTION,
      method: "POST",
      path: "/api/auth/sign-in/email",
      status: 200,
      code: SIGN_IN_CODE,
      summary: "Signed in",
    });
  });

  it("falls back to a generic path when the endpoint is unknown or odd", () => {
    for (const odd of [undefined, null, "", 42, "sign-in", "/sign-in?x=<b>"]) {
      expect(signInAudit(odd).path).toBe("/api/auth/sign-in");
    }
  });
});
