import { describe, expect, it } from "vitest";
import {
  ClientStockError,
  applyClientOutbound,
  applyClientReceive,
  assertOwnStockPicks,
  clientBalanceKey,
  isClientInboundMovement,
  isClientOutboundMovement,
  ownerBaysByItem,
  ownerOnHand,
  plannableQty,
  type BayReservation,
  type BayStock,
} from "./client-stock";
import { planAllocations } from "./allocations";
import { planQuickShip } from "./quick-ship";

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

  it("puts an unpicked client unit back in the client's balance", () => {
    expect(isClientInboundMovement("unpick")).toBe(true);
    expect(isClientInboundMovement("receive")).toBe(true);
    expect(isClientInboundMovement("move")).toBe(false);
  });
});

function bay(
  locationId: string,
  input: { onHand: number; available?: number; clients?: Record<string, number>; reservations?: BayReservation[]; itemId?: string },
): BayStock {
  return {
    locationId,
    locationCode: locationId.toUpperCase(),
    locationName: locationId,
    barcode: locationId.toUpperCase(),
    type: "storage",
    slotRole: "pick",
    zoneId: null,
    itemId: input.itemId ?? "lamp",
    onHand: input.onHand,
    available: input.available ?? input.onHand,
    clientQty: new Map(Object.entries(input.clients ?? {})),
    reservations: input.reservations ?? [],
  };
}

describe("stock ownership for pick plans", () => {
  it("splits a bay between its 3PL clients and own stock", () => {
    const shared = bay("a", { onHand: 10, clients: { acme: 6, zeta: 1 } });
    expect(ownerOnHand(shared, "acme")).toBe(6);
    expect(ownerOnHand(shared, "zeta")).toBe(1);
    expect(ownerOnHand(shared, "other")).toBe(0);
    expect(ownerOnHand(shared, null)).toBe(3);
  });

  it("lets a client order plan only its client's stock, and an own order only own stock", () => {
    const acmeOnly = bay("a", { onHand: 5, clients: { acme: 5 } });
    expect(plannableQty(acmeOnly, "acme")).toBe(5);
    expect(plannableQty(acmeOnly, "zeta")).toBe(0);
    expect(plannableQty(acmeOnly, null)).toBe(0);
    const ownOnly = bay("b", { onHand: 4 });
    expect(plannableQty(ownOnly, null)).toBe(4);
    expect(plannableQty(ownOnly, "acme")).toBe(0);
  });

  it("takes reservations off the owner they belong to, and holds off everyone", () => {
    const shared = bay("a", {
      onHand: 10,
      available: 8,
      clients: { acme: 5 },
      reservations: [
        { orderId: "o-acme", clientId: "acme", qty: 3 },
        { orderId: "o-own", clientId: null, qty: 1 },
      ],
    });
    expect(plannableQty(shared, "acme")).toBe(2);
    expect(plannableQty(shared, null)).toBe(4);
    expect(plannableQty(shared, "acme", "o-acme")).toBe(5);
    const held = bay("b", { onHand: 6, available: 1, clients: { acme: 3 } });
    expect(plannableQty(held, "acme")).toBe(1);
    expect(plannableQty(held, null)).toBe(1);
  });

  it("never plans below zero when own orders already reserved client units", () => {
    const legacy = bay("a", { onHand: 4, clients: { acme: 4 }, reservations: [{ orderId: "old", clientId: null, qty: 2 }] });
    expect(plannableQty(legacy, null)).toBe(0);
    expect(plannableQty(legacy, "acme")).toBe(2);
  });

  it("plans a client order away from a bay where only another owner has stock", () => {
    const stock = [bay("front", { onHand: 8, clients: { zeta: 8 } }), bay("back", { onHand: 3, clients: { acme: 3 } })];
    const acme = ownerBaysByItem(stock, { owner: "acme" });
    expect(acme.get("lamp")!.map((row) => [row.locationId, row.qty])).toEqual([
      ["front", 0],
      ["back", 3],
    ]);
    const { drafts, short } = planAllocations({
      lines: [{ lineId: "l1", itemId: "lamp", sku: "LAMP", remaining: 4 }],
      baysByItem: acme,
    });
    expect(drafts.map((row) => [row.locationId, row.qty])).toEqual([["back", 3]]);
    expect(short).toEqual([{ sku: "LAMP", remaining: 1, atp: 3 }]);
  });

  it("keeps quick-ship from planning an own-stock order out of client stock", () => {
    const stock = [bay("front", { onHand: 5, clients: { acme: 5 } })];
    const order = {
      status: "open",
      packageCount: 0,
      lines: [{ id: "l1", itemId: "lamp", sku: "LAMP", qty: 2, qtyPicked: 0, qtyPacked: 0 }],
    };
    expect(planQuickShip(order, ownerBaysByItem(stock, { owner: null }))).toMatchObject({ ok: false, code: "INSUFFICIENT_ATP" });
    expect(planQuickShip(order, ownerBaysByItem(stock, { owner: "acme" }))).toMatchObject({
      ok: true,
      picks: [{ locationId: "front", lines: [{ lineId: "l1", qty: 2 }] }],
    });
  });

  it("counts an order's own reservation as free for that order in the ship queue", () => {
    const stock = [bay("front", { onHand: 2, clients: { acme: 2 }, reservations: [{ orderId: "o1", clientId: "acme", qty: 2 }] })];
    expect(ownerBaysByItem(stock, { owner: "acme", excludeOrderId: "o1" }).get("lamp")![0]!.qty).toBe(2);
    expect(ownerBaysByItem(stock, { owner: "acme", excludeOrderId: "o2" }).get("lamp")![0]!.qty).toBe(0);
  });
});

describe("own-stock picks", () => {
  const onHand = new Map([["a:lamp", 10]]);
  const clientUnits = new Map([["a:lamp", 7]]);

  it("refuses an own pick that reaches into client stock, counting picks in the same plan", () => {
    const pick = (qty: number, clientId: string | null = null) => ({ type: "pick", itemId: "lamp", qty, fromLocationId: "a", clientId });
    expect(() => assertOwnStockPicks([pick(3)], onHand, clientUnits)).not.toThrow();
    expect(() => assertOwnStockPicks([pick(2), pick(2)], onHand, clientUnits)).toThrow(ClientStockError);
    try {
      assertOwnStockPicks([pick(4)], onHand, clientUnits);
    } catch (err) {
      expect(err).toMatchObject({ clientId: null, itemId: "lamp", onHand: 3, needed: 4 });
    }
  });

  it("leaves client picks, other movements, and bays without client stock alone", () => {
    expect(() =>
      assertOwnStockPicks(
        [
          { type: "pick", itemId: "lamp", qty: 7, fromLocationId: "a", clientId: "acme" },
          { type: "move", itemId: "lamp", qty: 9, fromLocationId: "a" },
          { type: "pick", itemId: "lamp", qty: 5, fromLocationId: "b" },
        ],
        new Map([...onHand, ["b:lamp", 5]]),
        clientUnits,
      ),
    ).not.toThrow();
  });
});
