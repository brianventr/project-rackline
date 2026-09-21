import { describe, expect, it } from "vitest";
import {
  assertOauthShop,
  shopifyAuthorizeUrl,
  shopifyOAuthMessage,
  signOAuthState,
  verifyOAuthState,
  verifyShopifyOAuthHmac,
} from "./shopify-oauth";

describe("shopify oauth", () => {
  it("builds the install URL for a myshopify shop", () => {
    expect(assertOauthShop("Northwind-Makers")).toBe("northwind-makers.myshopify.com");
    const url = new URL(
      shopifyAuthorizeUrl({
        shop: "northwind-makers.myshopify.com",
        clientId: "key",
        redirectUri: "https://rackline.example/api/shopify/oauth/callback",
        state: "signed",
        scopes: ["read_orders", "write_orders"],
      }),
    );
    expect(url.origin + url.pathname).toBe("https://northwind-makers.myshopify.com/admin/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("read_orders,write_orders");
    expect(url.searchParams.get("state")).toBe("signed");
  });

  it("rejects a shop that is not on myshopify.com", () => {
    expect(() => assertOauthShop("shop.example.com")).toThrow(/myshopify.com/);
  });

  it("signs state and checks the Shopify query hmac", async () => {
    const secret = "oauth-secret";
    const state = await signOAuthState(secret, {
      organizationId: "org-1",
      shop: "northwind-makers.myshopify.com",
      exp: Date.now() + 60_000,
    });
    await expect(verifyOAuthState(secret, state)).resolves.toMatchObject({ organizationId: "org-1" });
    await expect(verifyOAuthState("other", state)).rejects.toThrow(/rejected/);

    const params = new URLSearchParams({
      code: "abc",
      shop: "northwind-makers.myshopify.com",
      state,
      timestamp: "1337178173",
    });
    const message = shopifyOAuthMessage(params);
    expect(message.startsWith("code=")).toBe(true);
    expect(message.includes("hmac=")).toBe(false);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    const hmac = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    params.set("hmac", hmac);
    expect(await verifyShopifyOAuthHmac(params, secret)).toBe(true);
    params.set("hmac", "00");
    expect(await verifyShopifyOAuthHmac(params, secret)).toBe(false);
  });
});
