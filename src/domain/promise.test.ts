import { describe, expect, it } from "vitest";
import { LIVE_PACE_MIN_MS } from "./live";
import {
  askPromise,
  cutoffLabel,
  floorPace,
  formatPickupLabel,
  nextPickup,
  parseCutoff,
  parsePromiseQty,
  planPromises,
  quotePromise,
  type PromiseOrderInput,
  type PromiseStock,
} from "./promise";

const TZ = "America/Los_Angeles";
/** Tue Sep 22, 2026 8:30am PDT. */
const NOW = Date.UTC(2026, 8, 22, 15, 30, 0);
const TODAY_PICKUP = Date.UTC(2026, 8, 22, 22, 0, 0);
const NEXT_PICKUP = Date.UTC(2026, 8, 23, 22, 0, 0);

function stock(partial: Partial<PromiseStock> & Pick<PromiseStock, "itemId" | "sku">): PromiseStock {
  return { name: partial.sku, sellable: 0, ...partial };
}

function order(partial: Partial<PromiseOrderInput> & Pick<PromiseOrderInput, "id" | "lines">): PromiseOrderInput {
  return {
    number: partial.id,
    customerName: "Harbor",
    status: "open",
    createdAt: 1,
    ...partial,
  };
}

describe("cutoff and pickup", () => {
  it("parses HH:MM and rejects junk", () => {
    expect(parseCutoff("15:00")).toBe(15 * 60);
    expect(parseCutoff("9:05")).toBe(9 * 60 + 5);
    expect(parseCutoff("900")).toBe(900);
    expect(cutoffLabel(15 * 60)).toBe("3:00 PM");
    expect(cutoffLabel(8 * 60)).toBe("8:00 AM");
    expect(() => parseCutoff("3pm")).toThrow(/HH:MM/);
    expect(() => parseCutoff("24:00")).toThrow(/HH:MM/);
    expect(() => parsePromiseQty(0)).toThrow(/positive integer/);
    expect(() => parsePromiseQty(1.5)).toThrow(/positive integer/);
  });

  it("snaps to the cutoff on this local day, then the next", () => {
    expect(nextPickup(NOW, TZ, 15 * 60)).toBe(TODAY_PICKUP);
    expect(nextPickup(TODAY_PICKUP, TZ, 15 * 60)).toBe(TODAY_PICKUP);
    expect(nextPickup(TODAY_PICKUP + 60_000, TZ, 15 * 60)).toBe(NEXT_PICKUP);
  });
});

describe("floor pace", () => {
  it("stays blank until 15 minutes of work exist", () => {
    const now = 10 * 60 * 60 * 1000;
    expect(floorPace([{ at: now - 5 * 60_000, qty: 10 }], now, 0)).toBeNull();
    const started = now - LIVE_PACE_MIN_MS - 5 * 60_000;
    const rate = floorPace(
      [
        { at: started, qty: 20 },
        { at: now, qty: 10 },
      ],
      now,
      0,
    );
    expect(rate).toBeGreaterThan(0);
  });
});

describe("quotePromise", () => {
  it("leaves on today's pickup when the shelf covers the qty", () => {
    const lots = [{ qty: 4, expiresOn: null }];
    const quote = quotePromise({
      qty: 4,
      sellable: 10,
      lots,
      pacePerHour: 40,
      now: NOW,
      timeZone: TZ,
    });
    expect(quote.code).toBe("leaves_today");
    expect(quote.promisedAt).toBe(TODAY_PICKUP);
    expect(quote.shipDay).toBe("2026-09-22");
    expect(quote.reason).toBe("On the shelf. Leaves on today's 3:00 PM pickup.");
    expect(quote.waitingOn).toBeNull();
    expect(lots[0].qty).toBe(4);
  });

  it("rolls to the next pickup when the queue misses the cutoff", () => {
    const quote = quotePromise({
      qty: 10,
      sellable: 10,
      aheadUnits: 400,
      pacePerHour: 40,
      now: NOW,
      timeZone: TZ,
    });
    expect(quote.code).toBe("next_pickup");
    expect(quote.promisedAt).toBe(NEXT_PICKUP);
    expect(quote.reason).toBe(`On the shelf, behind 400 units. Leaves ${formatPickupLabel(NEXT_PICKUP, TZ)}.`);
  });

  it("uses the bench rate when pace is blank", () => {
    const quote = quotePromise({
      qty: 10,
      sellable: 10,
      aheadUnits: 400,
      pacePerHour: null,
      now: NOW,
      timeZone: TZ,
    });
    expect(quote.promisedAt).toBe(NEXT_PICKUP);
  });

  it("waits on dated inbound plus dock slack and does not treat that as a reservation", () => {
    const inbound = [{ at: NOW, qty: 4, ref: "ASN-1" }];
    const quote = quotePromise({
      qty: 4,
      sellable: 0,
      inbound,
      pacePerHour: 40,
      now: NOW,
      timeZone: TZ,
    });
    expect(quote.code).toBe("inbound");
    expect(quote.promisedAt).toBe(TODAY_PICKUP);
    expect(quote.waitingOn).toBe("ASN-1");
    expect(quote.reason).toBe(
      "None on the shelf. ASN-1 covers 4 after the dock. Leaves on today's 3:00 PM pickup.",
    );
    expect(inbound[0].qty).toBe(4);
  });

  it("says what is still uncovered when inbound is short", () => {
    const quote = quotePromise({
      qty: 6,
      sellable: 1,
      inbound: [{ at: NOW, qty: 3, ref: "PO-1" }],
      pacePerHour: 40,
      now: NOW,
      timeZone: TZ,
    });
    expect(quote.code).toBe("short");
    expect(quote.promisedAt).toBeNull();
    expect(quote.reason).toBe("1 on the shelf. PO-1 covers 3. Nothing dated covers the other 2.");
  });

  it("drops lots that expire before a later pickup", () => {
    const quote = quotePromise({
      qty: 10,
      sellable: 10,
      lots: [{ qty: 10, expiresOn: 20260922 }],
      aheadUnits: 400,
      pacePerHour: 40,
      now: NOW,
      timeZone: TZ,
    });
    expect(quote.code).toBe("short");
    expect(quote.reason).toBe("10 on hand expire before they can ship. Nothing dated covers 10.");
  });

  it("honors an earlier cutoff", () => {
    const quote = quotePromise({
      qty: 1,
      sellable: 5,
      pacePerHour: 40,
      now: NOW,
      timeZone: TZ,
      cutoffMinutes: 8 * 60,
    });
    const pickup = Date.UTC(2026, 8, 23, 15, 0, 0);
    expect(quote.code).toBe("next_pickup");
    expect(quote.promisedAt).toBe(pickup);
    expect(quote.reason).toContain("8:00 AM");
  });
});

describe("planPromises", () => {
  it("gives the shelf to the earlier order and does not promise it twice", () => {
    const inbound = [{ at: NOW + 86_400_000, qty: 10, ref: "ASN-1" }];
    const plan = planPromises({
      now: NOW,
      timeZone: TZ,
      pacePerHour: 400,
      orders: [
        order({
          id: "a",
          createdAt: 1,
          lines: [{ itemId: "lamp", sku: "LAMP", name: "Lamp", qty: 6, pickQty: 6 }],
        }),
        order({
          id: "b",
          createdAt: 2,
          lines: [{ itemId: "lamp", sku: "LAMP", name: "Lamp", qty: 8, pickQty: 8 }],
        }),
      ],
      stock: [stock({ itemId: "lamp", sku: "LAMP", sellable: 10, inbound })],
    });
    const first = plan.board.orders.find((row) => row.orderId === "a");
    const second = plan.board.orders.find((row) => row.orderId === "b");
    expect(first?.code).toBe("leaves_today");
    expect(second?.code).toBe("inbound");
    expect(second?.waitingOn).toBe("ASN-1");
    expect(second?.reason.startsWith("LAMP:")).toBe(true);
    expect(inbound[0].qty).toBe(10);
    expect(plan.board.reservesStock).toBe(false);
    expect(plan.board.kpis).toEqual({ leavesToday: 1, nextPickup: 0, inbound: 1, short: 0 });

    const ask = askPromise(plan, { itemId: "lamp", sku: "LAMP", name: "Lamp", qty: 1 }, NOW, TZ, 400);
    expect(ask.code).toBe("inbound");
    expect(ask.reservesStock).toBe(false);
    expect(ask.unitsAhead).toBe(14);
  });

  it("a picked order takes the next cutoff and leaves the shelf for the order behind it", () => {
    const plan = planPromises({
      now: NOW,
      timeZone: TZ,
      pacePerHour: 40,
      orders: [
        order({
          id: "packed",
          status: "packed",
          createdAt: 1,
          lines: [{ itemId: "lamp", sku: "LAMP", name: "Lamp", qty: 9, pickQty: 0 }],
        }),
        order({
          id: "open",
          createdAt: 2,
          lines: [{ itemId: "lamp", sku: "LAMP", name: "Lamp", qty: 5, pickQty: 5 }],
        }),
      ],
      stock: [stock({ itemId: "lamp", sku: "LAMP", sellable: 5 })],
    });
    expect(plan.board.orders.find((row) => row.orderId === "packed")?.code).toBe("leaves_today");
    expect(plan.board.orders.find((row) => row.orderId === "packed")?.reason).toBe(
      "Picked. Leaves on today's 3:00 PM pickup.",
    );
    expect(plan.board.orders.find((row) => row.orderId === "open")?.code).toBe("leaves_today");
  });

  it("marks a split when one line makes this pickup and a sibling misses it", () => {
    const noon = Date.UTC(2026, 8, 22, 19, 0, 0);
    const plan = planPromises({
      now: noon,
      timeZone: TZ,
      pacePerHour: 40,
      orders: [
        order({
          id: "ord",
          lines: [
            { itemId: "base", sku: "BASE", name: "Base", qty: 40, pickQty: 40 },
            { itemId: "cord", sku: "CORD", name: "Cord", qty: 200, pickQty: 200 },
          ],
        }),
      ],
      stock: [
        stock({ itemId: "base", sku: "BASE", sellable: 40 }),
        stock({ itemId: "cord", sku: "CORD", sellable: 200 }),
      ],
    });
    const row = plan.board.orders[0];
    expect(row?.split).toBe(true);
    expect(row?.code).toBe("next_pickup");
    expect(row?.slowSku).toBe("CORD");
    expect(row?.lines.find((line) => line.sku === "BASE")?.code).toBe("leaves_today");
  });

  it("omits a picked order the carrier already has", () => {
    const plan = planPromises({
      now: NOW,
      timeZone: TZ,
      pacePerHour: 40,
      orders: [
        order({
          id: "dfw",
          status: "packed",
          createdAt: 1,
          handedOff: true,
          lines: [{ itemId: "lamp", sku: "LAMP", name: "Lamp", qty: 2, pickQty: 0 }],
        }),
        order({
          id: "open",
          createdAt: 2,
          lines: [{ itemId: "lamp", sku: "LAMP", name: "Lamp", qty: 1, pickQty: 1 }],
        }),
      ],
      stock: [stock({ itemId: "lamp", sku: "LAMP", sellable: 1 })],
    });
    expect(plan.board.orders.map((row) => row.orderId)).toEqual(["open"]);
    expect(plan.board.orders[0]?.code).toBe("leaves_today");
  });

  it("sorts orders that cannot be promised ahead of ones that leave today", () => {
    const plan = planPromises({
      now: NOW,
      timeZone: TZ,
      pacePerHour: 40,
      orders: [
        order({
          id: "ready",
          createdAt: 1,
          lines: [{ itemId: "lamp", sku: "LAMP", name: "Lamp", qty: 1, pickQty: 1 }],
        }),
        order({
          id: "short",
          createdAt: 2,
          lines: [{ itemId: "cord", sku: "CORD", name: "Cord", qty: 4, pickQty: 4 }],
        }),
      ],
      stock: [stock({ itemId: "lamp", sku: "LAMP", sellable: 1 })],
    });
    expect(plan.board.orders.map((row) => row.orderId)).toEqual(["short", "ready"]);
    expect(plan.board.orders[0]?.code).toBe("short");
  });
});
