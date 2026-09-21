import { describe, expect, it } from "vitest";
import {
  canVoidLabel,
  enabledServicesFromConnections,
  parseEnabledServices,
  quoteRates,
  resolveLabelPurchase,
  serializeCarrierConnection,
  testConnectionResult,
  trackingPrefixFor,
  trackingUrlForService,
  validateConnectionCredentials,
  type CarrierConnectionLike,
} from "./carriers";

function connection(overrides: Partial<CarrierConnectionLike> & Pick<CarrierConnectionLike, "id" | "provider">): CarrierConnectionLike {
  return {
    nickname: overrides.provider,
    accountNumber: null,
    mode: "demo",
    status: "connected",
    apiKey: null,
    apiSecret: null,
    meterNumber: null,
    enabledServicesJson: "[]",
    isDefault: false,
    ...overrides,
  };
}

describe("carrier credentials", () => {
  it("rejects live UPS without an API key and allows demo", () => {
    expect(
      validateConnectionCredentials("ups", { mode: "live", accountNumber: "A1B2C3" }).ok,
    ).toBe(false);
    expect(validateConnectionCredentials("ups", { mode: "demo", accountNumber: "A1B2C3" })).toEqual({
      ok: true,
    });
    expect(
      validateConnectionCredentials("ups", {
        mode: "live",
        accountNumber: "A1B2C3",
        apiKey: "key",
        apiSecret: "secret",
      }),
    ).toEqual({ ok: true });
  });

  it("requires an aggregator key only in live mode", () => {
    expect(validateConnectionCredentials("easypost", { mode: "live" }).ok).toBe(false);
    expect(validateConnectionCredentials("easypost", { mode: "demo" }).ok).toBe(true);
    expect(testConnectionResult({ provider: "easypost", mode: "demo", credentials: {} }).ok).toBe(true);
    const live = testConnectionResult({
      provider: "easypost",
      mode: "live",
      credentials: { apiKey: "EZTK_test" },
    });
    expect(live).toEqual(expect.objectContaining({ ok: true, message: expect.stringContaining("purchases postage") }));
    const direct = testConnectionResult({
      provider: "ups",
      mode: "live",
      credentials: { accountNumber: "A1B2C3", apiKey: "key", apiSecret: "secret" },
    });
    expect(direct).toEqual(
      expect.objectContaining({ ok: true, message: expect.stringContaining("purchases postage") }),
    );
  });
});

describe("serializeCarrierConnection", () => {
  it("masks secrets and never echoes the raw key", () => {
    const serialized = serializeCarrierConnection(
      connection({
        id: "conn-1",
        provider: "ups",
        apiKey: "shpk_live_abcd1234",
        apiSecret: "supersecretvalue",
        enabledServicesJson: JSON.stringify(["ups_ground"]),
      }),
    );
    expect(serialized.apiKeyHint).toBe("••••1234");
    expect(serialized.apiSecretHint).toBe("••••alue");
    expect(serialized.hasApiKey).toBe(true);
    expect(serialized).not.toHaveProperty("apiKey");
    expect(serialized).not.toHaveProperty("apiSecret");
    expect(JSON.stringify(serialized)).not.toContain("shpk_live_abcd1234");
  });
});

describe("enabled services and purchase", () => {
  it("lets an aggregator demo unlock child services", () => {
    const easypost = connection({
      id: "ez-1",
      provider: "easypost",
      isDefault: true,
      enabledServicesJson: JSON.stringify(["ups_ground", "fedex_ground"]),
    });
    const enabled = enabledServicesFromConnections([easypost]).map((row) => row.id);
    expect(enabled).toContain("ups_ground");
    expect(enabled).toContain("fedex_ground");
    expect(enabled).toContain("rackline_ground");
    expect(resolveLabelPurchase({ connections: [easypost], serviceId: "fedex_ground" })).toEqual(
      expect.objectContaining({ ok: true, connectionId: "ez-1" }),
    );
  });

  it("blocks a disabled service on a connected account", () => {
    const ups = connection({
      id: "ups-1",
      provider: "ups",
      enabledServicesJson: JSON.stringify(["ups_ground"]),
    });
    expect(parseEnabledServices(ups.enabledServicesJson, "ups")).toEqual(["ups_ground"]);
    expect(resolveLabelPurchase({ connections: [ups], serviceId: "ups_2day" })).toEqual({
      ok: false,
      error: "Carrier service is not enabled on a connected account",
    });
    expect(resolveLabelPurchase({ connections: [ups], serviceId: "not_a_service" })).toEqual({
      ok: false,
      error: "Unknown carrier service",
    });
  });
});

describe("rates, tracking, void", () => {
  it("quotes only enabled services and is deterministic", () => {
    const services = enabledServicesFromConnections([
      connection({
        id: "ups-1",
        provider: "ups",
        enabledServicesJson: JSON.stringify(["ups_ground", "ups_2day"]),
      }),
    ]);
    const quoted = quoteRates({
      services: services.filter((row) => row.provider === "ups"),
      shipFrom: "Portland, OR",
      shipTo: "Seattle, WA",
    });
    expect(quoted.map((row) => row.id)).toEqual(["ups_ground", "ups_2day"]);
    expect(quoted.every((row) => row.amountCents > 0)).toBe(true);
    expect(quoted[1].transitDays).toBe(2);
    expect(
      quoteRates({
        services: quoted,
        shipFrom: "Portland, OR",
        shipTo: "Seattle, WA",
      })[0].amountCents,
    ).toBe(quoted[0].amountCents);
  });

  it("uses carrier tracking prefixes and public URLs", () => {
    expect(trackingPrefixFor("rackline_ground")).toBe("RL-");
    expect(trackingPrefixFor("ups_ground")).toBe("1Z");
    expect(trackingPrefixFor("usps_priority")).toBe("9400");
    expect(trackingPrefixFor("fedex_ground")).toBe("FE-");
    expect(trackingPrefixFor("dhl_express")).toBe("DHL-");
    expect(trackingUrlForService("1ZAAAAAAAAAA", "ups_ground")).toContain("ups.com/track");
    expect(trackingUrlForService("9400AAAAAAAAAA", "usps_priority")).toContain("usps.com");
  });

  it("blocks void after ship", () => {
    expect(canVoidLabel({ status: "packed", labelStatus: "purchased" })).toEqual({ ok: true });
    expect(canVoidLabel({ status: "shipped", labelStatus: "purchased" })).toEqual({
      ok: false,
      error: "Shipped orders cannot void a label",
      code: "SHIPPED",
    });
    expect(canVoidLabel({ status: "packed", labelStatus: "none" }).ok).toBe(false);
    expect(canVoidLabel({ status: "packed", labelStatus: "purchased", shippedAt: 1 })).toMatchObject({
      ok: false,
      code: "SHIPPED",
    });
  });
});
