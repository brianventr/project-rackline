import { describe, expect, it } from "vitest";
import {
  ClientStockError,
  applyClientOutbound,
  applyClientReceive,
  clientBalanceKey,
  isClientOutboundMovement,
} from "./client-stock";

describe("client stock overlay", () => {
  it("receives into client balance", () => {
    const key = clientBalanceKey("loc", "item", "client");
    const next = applyClientReceive(new Map(), { locationId: "loc", itemId: "item", clientId: "client", qty: 5 });
    expect(next.get(key)).toBe(5);
    const again = applyClientReceive(next, { locationId: "loc", itemId: "item", clientId: "client", qty: 2 });
    expect(again.get(key)).toBe(7);
  });

  it("outbound reduces and rejects short client qty", () => {
    const seeded = applyClientReceive(new Map(), {
      locationId: "loc",
      itemId: "item",
      clientId: "client",
      qty: 3,
    });
    const next = applyClientOutbound(seeded, {
      locationId: "loc",
      itemId: "item",
      clientId: "client",
      qty: 2,
    });
    expect(next.get(clientBalanceKey("loc", "item", "client"))).toBe(1);
    expect(() =>
      applyClientOutbound(next, { locationId: "loc", itemId: "item", clientId: "client", qty: 2 }),
    ).toThrow(ClientStockError);
    expect(isClientOutboundMovement("unreceive")).toBe(true);
    expect(isClientOutboundMovement("pick")).toBe(true);
  });
});
