import { describe, expect, it, vi } from "vitest";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { openCarrierRow, openShopifyRow } from "./credentials";
import { isSealed, openSecret, sealSecret, secretFingerprint } from "../lib/secret-box";

const SECRET = "credentials-test-secret-0123456789";

/** Just enough of drizzle for the reseal: `update(table).set(values).where(...)`. */
function fakeDb(options: { failWrite?: boolean } = {}) {
  const writes: { table: unknown; values: Record<string, unknown> }[] = [];
  const db = {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (options.failWrite) throw new Error("D1 overloaded");
          writes.push({ table, values });
        },
      }),
    }),
  };
  return { db: db as unknown as AppDb, writes };
}

function carrierRow(keys: {
  apiKey: string | null;
  apiSecret: string | null;
  meterNumber?: string | null;
  webhookSecret?: string | null;
  webhookSecretFp?: string | null;
}): typeof schema.carrierConnections.$inferSelect {
  return {
    id: "car-1",
    organizationId: "org-1",
    provider: "ups",
    nickname: "UPS",
    accountNumber: "A1B2C3",
    mode: "live",
    status: "connected",
    apiKey: keys.apiKey,
    apiSecret: keys.apiSecret,
    meterNumber: keys.meterNumber ?? null,
    enabledServicesJson: "[]",
    webhookSecret: keys.webhookSecret ?? null,
    webhookSecretFp: keys.webhookSecretFp ?? null,
    isDefault: false,
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestError: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function shopifyRow(accessToken: string | null, webhookSecret = ""): typeof schema.shopifyConnections.$inferSelect {
  return {
    id: "shop-1",
    organizationId: "org-1",
    shopDomain: "northwind.myshopify.com",
    accessToken,
    webhookSecret,
    apiVersion: "2026-07",
    shopifyLocationGid: null,
    mode: "live",
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("openCarrierRow", () => {
  it("opens sealed keys and writes nothing", async () => {
    const { db, writes } = fakeDb();
    const row = carrierRow({ apiKey: await sealSecret(SECRET, "ups-id-4321"), apiSecret: await sealSecret(SECRET, "ups-secret-8765") });
    const opened = await openCarrierRow(db, () => SECRET, row);
    expect(opened).toMatchObject({ apiKey: "ups-id-4321", apiSecret: "ups-secret-8765" });
    expect(writes).toEqual([]);
  });

  it("reads plain keys from before sealing as is, and seals them in place", async () => {
    const { db, writes } = fakeDb();
    const opened = await openCarrierRow(db, () => SECRET, carrierRow({ apiKey: "ups-id-4321", apiSecret: "ups-secret-8765" }));
    expect(opened).toMatchObject({ apiKey: "ups-id-4321", apiSecret: "ups-secret-8765" });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.table).toBe(schema.carrierConnections);
    const { apiKey, apiSecret } = writes[0]!.values as { apiKey: string; apiSecret: string };
    expect(await openSecret(SECRET, apiKey)).toBe("ups-id-4321");
    expect(await openSecret(SECRET, apiSecret)).toBe("ups-secret-8765");
  });

  it("seals only the plain key when the other is already sealed", async () => {
    const { db, writes } = fakeDb();
    const sealedKey = await sealSecret(SECRET, "ups-id-4321");
    const opened = await openCarrierRow(db, () => SECRET, carrierRow({ apiKey: sealedKey, apiSecret: "ups-secret-8765" }));
    expect(opened).toMatchObject({ apiKey: "ups-id-4321", apiSecret: "ups-secret-8765" });
    expect(Object.keys(writes[0]!.values)).toEqual(["apiSecret"]);
    expect(isSealed(writes[0]!.values.apiSecret as string)).toBe(true);
  });

  it("opens and seals a FedEx client secret kept in the meter number", async () => {
    const { db, writes } = fakeDb();
    const row = carrierRow({ apiKey: await sealSecret(SECRET, "fedex-id-1111"), apiSecret: null, meterNumber: "fedex-secret-2222" });
    const opened = await openCarrierRow(db, () => SECRET, row);
    expect(opened).toMatchObject({ apiKey: "fedex-id-1111", apiSecret: null, meterNumber: "fedex-secret-2222" });
    expect(Object.keys(writes[0]!.values)).toEqual(["meterNumber"]);
    expect(await openSecret(SECRET, writes[0]!.values.meterNumber as string)).toBe("fedex-secret-2222");
  });

  it("reads a key sealed under another secret as missing and leaves it stored", async () => {
    const { db, writes } = fakeDb();
    const row = carrierRow({ apiKey: await sealSecret("an-older-secret", "ups-id-4321"), apiSecret: null });
    expect((await openCarrierRow(db, () => SECRET, row)).apiKey).toBeNull();
    expect(writes).toEqual([]);
  });

  it("does not ask for the secret when there are no keys", async () => {
    const { db } = fakeDb();
    const secret = vi.fn(() => SECRET);
    const row = carrierRow({ apiKey: null, apiSecret: null });
    expect(await openCarrierRow(db, secret, row)).toBe(row);
    expect(secret).not.toHaveBeenCalled();
  });

  it("reads a plain tracker webhook secret and seals it with its fingerprint", async () => {
    const { db, writes } = fakeDb();
    const opened = await openCarrierRow(db, () => SECRET, carrierRow({ apiKey: null, apiSecret: null, webhookSecret: "whsec_live" }));
    expect(opened.webhookSecret).toBe("whsec_live");
    expect(writes).toHaveLength(1);
    expect(await openSecret(SECRET, writes[0]!.values.webhookSecret as string)).toBe("whsec_live");
    expect(writes[0]!.values.webhookSecretFp).toBe(await secretFingerprint("whsec_live"));
    expect(isSealed(writes[0]!.values.webhookSecret as string)).toBe(true);
  });

  it("opens a sealed tracker webhook secret and writes nothing", async () => {
    const { db, writes } = fakeDb();
    const sealed = await sealSecret(SECRET, "whsec_live");
    const opened = await openCarrierRow(db, () => SECRET, carrierRow({ apiKey: null, apiSecret: null, webhookSecret: sealed, webhookSecretFp: await secretFingerprint("whsec_live") }));
    expect(opened.webhookSecret).toBe("whsec_live");
    expect(writes).toEqual([]);
  });

  it("stores the fingerprint of a sealed webhook secret that does not have one yet", async () => {
    const { db, writes } = fakeDb();
    const sealed = await sealSecret(SECRET, "whsec_live");
    const opened = await openCarrierRow(db, () => SECRET, carrierRow({ apiKey: null, apiSecret: null, webhookSecret: sealed }));
    expect(opened.webhookSecret).toBe("whsec_live");
    expect(writes[0]!.values).toEqual({ webhookSecretFp: await secretFingerprint("whsec_live") });
  });

  it("still returns the keys when sealing them in place fails", async () => {
    const { db } = fakeDb({ failWrite: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const opened = await openCarrierRow(db, () => SECRET, carrierRow({ apiKey: "ups-id-4321", apiSecret: null }));
    expect(opened.apiKey).toBe("ups-id-4321");
    expect(warn).toHaveBeenCalledWith("credential reseal failed", expect.any(Error));
    warn.mockRestore();
  });
});

describe("openShopifyRow", () => {
  it("opens a sealed Admin token and writes nothing", async () => {
    const { db, writes } = fakeDb();
    const opened = await openShopifyRow(db, () => SECRET, shopifyRow(await sealSecret(SECRET, "shpat_live_1234")));
    expect(opened.accessToken).toBe("shpat_live_1234");
    expect(writes).toEqual([]);
  });

  it("reads a plain token from before sealing as is, and seals it in place", async () => {
    const { db, writes } = fakeDb();
    const opened = await openShopifyRow(db, () => SECRET, shopifyRow("shpat_live_1234"));
    expect(opened.accessToken).toBe("shpat_live_1234");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.table).toBe(schema.shopifyConnections);
    expect(await openSecret(SECRET, writes[0]!.values.accessToken as string)).toBe("shpat_live_1234");
  });

  it("reads a token sealed under another secret as missing", async () => {
    const { db, writes } = fakeDb();
    const opened = await openShopifyRow(db, () => SECRET, shopifyRow(await sealSecret("an-older-secret", "shpat_live_1234")));
    expect(opened.accessToken).toBeNull();
    expect(writes).toEqual([]);
  });

  it("does not ask for the secret for a demo connection with no token", async () => {
    const { db } = fakeDb();
    const secret = vi.fn(() => SECRET);
    await openShopifyRow(db, secret, shopifyRow(null));
    expect(secret).not.toHaveBeenCalled();
  });

  it("reads a plain Shopify webhook secret and seals it, with or without an Admin token", async () => {
    const { db, writes } = fakeDb();
    const opened = await openShopifyRow(db, () => SECRET, shopifyRow(null, "shpss_plain"));
    expect(opened.webhookSecret).toBe("shpss_plain");
    expect(writes).toHaveLength(1);
    expect(Object.keys(writes[0]!.values)).toEqual(["webhookSecret"]);
    expect(await openSecret(SECRET, writes[0]!.values.webhookSecret as string)).toBe("shpss_plain");
  });

  it("opens a sealed Shopify webhook secret and writes nothing", async () => {
    const { db, writes } = fakeDb();
    const sealed = await sealSecret(SECRET, "shpss_live");
    const opened = await openShopifyRow(db, () => SECRET, shopifyRow(null, sealed ?? undefined));
    expect(opened.webhookSecret).toBe("shpss_live");
    expect(writes).toEqual([]);
  });

  it("reads a Shopify webhook secret sealed under another key as missing", async () => {
    const { db, writes } = fakeDb();
    const sealed = await sealSecret("an-older-secret", "shpss_live");
    const opened = await openShopifyRow(db, () => SECRET, shopifyRow(null, sealed ?? undefined));
    expect(opened.webhookSecret).toBe("");
    expect(writes).toEqual([]);
  });
});
