import { describe, expect, it } from "vitest";
import {
  buildOrderPickList,
  buildWavePickList,
  formatPickUom,
  formatShipToIdentity,
  formatWalkStrip,
  pickLotsAtBay,
  reservationCopy,
} from "./pick-list";

const a0101 = {
  id: "a0101",
  code: "A-01-01",
  barcode: "LOC-A0101",
  aisle: "A",
  rack: "01",
  bay: "01",
  level: 1,
  zoneName: "Zone A",
};
const a0102 = {
  id: "a0102",
  code: "A-01-02",
  barcode: "LOC-A0102",
  aisle: "A",
  rack: "01",
  bay: "02",
  level: 1,
};
const b0101 = {
  id: "b0101",
  code: "B-01-01",
  barcode: "LOC-B0101",
  aisle: "B",
  rack: "01",
  bay: "01",
  level: 1,
};

describe("buildOrderPickList", () => {
  it("prefers allocations over the suggested bay and walks aisle then rack", () => {
    const doc = buildOrderPickList({
      order: {
        number: "ORD-1",
        customerName: "Harbor",
        status: "picking",
        lines: [
          {
            lineId: "l1",
            sku: "LAMP",
            itemName: "Desk lamp",
            remaining: 1,
            qtyOrdered: 1,
            qtyPicked: 0,
            suggestedLocation: { locationId: "a0102", locationCode: "A-01-02" },
            allocations: [{ locationId: "b0101", locationCode: "B-01-01", qty: 1 }],
          },
          {
            lineId: "l2",
            sku: "SHADE",
            itemName: "Shade",
            remaining: 2,
            qtyOrdered: 2,
            qtyPicked: 0,
            suggestedLocation: { locationId: "a0101", locationCode: "A-01-01" },
          },
        ],
      },
      locations: [a0101, a0102, b0101],
    });
    expect(doc.stops.map((stop) => stop.locationCode)).toEqual(["A-01-01", "B-01-01"]);
    expect(doc.walkStrip).toBe("A-01-01 → B-01-01");
    expect(doc.stops[0]?.skus[0]?.provenance).toBe("suggested");
    expect(doc.stops[1]?.skus[0]?.provenance).toBe("allocated");
    expect(doc.reservationNote).toBe("mixed");
    expect(reservationCopy(doc.reservationNote)).toMatch(/Reserved where allocated/);
  });

  it("lists unlocated remaining SKUs and skips completed lines into already picked", () => {
    const doc = buildOrderPickList({
      order: {
        number: "ORD-2",
        customerName: "Maya",
        status: "picking",
        lines: [
          {
            lineId: "l1",
            sku: "BASE",
            itemName: "Base",
            remaining: 0,
            qtyOrdered: 4,
            qtyPicked: 4,
            suggestedLocation: { locationId: "a0101", locationCode: "A-01-01" },
          },
          {
            lineId: "l2",
            sku: "CORD",
            itemName: "Cord",
            remaining: 3,
            qtyOrdered: 3,
            qtyPicked: 0,
          },
        ],
      },
      locations: [a0101],
    });
    expect(doc.stops).toEqual([]);
    expect(doc.unlocated).toEqual([
      { lineId: "l2", sku: "CORD", itemName: "Cord", remaining: 3, orderNumber: undefined },
    ]);
    expect(doc.alreadyPicked).toEqual([
      { lineId: "l1", sku: "BASE", itemName: "Base", qtyPicked: 4, qtyOrdered: 4, orderNumber: undefined },
    ]);
    expect(doc.remainingUnits).toBe(3);
    expect(doc.remainingLines).toBe(1);
  });

  it("overlays FEFO lots at the pick bay and skips expired stock", () => {
    const lots = pickLotsAtBay(
      [
        { locationId: "a0101", sku: "GLUE", lotCode: "LOT-DEAD", qty: 9, expiresOn: 20260101 },
        { locationId: "a0101", sku: "GLUE", lotCode: "LOT-OLD", qty: 2, expiresOn: 20261001 },
        { locationId: "a0101", sku: "GLUE", lotCode: "LOT-NEW", qty: 8, expiresOn: 20270301 },
      ],
      "a0101",
      "GLUE",
      3,
    );
    expect(lots.map((row) => `${row.lotCode}×${row.qty}`)).toEqual(["LOT-OLD×2", "LOT-NEW×1"]);
    expect(lots[0]?.expiresOnLabel).toBe("2026-10-01");

    const doc = buildOrderPickList({
      order: {
        number: "ORD-GLUE",
        customerName: "Harbor",
        status: "open",
        lines: [
          {
            lineId: "l1",
            sku: "GLUE",
            itemName: "Glue",
            remaining: 3,
            qtyOrdered: 3,
            qtyPicked: 0,
            trackLot: true,
            trackExpiry: true,
            suggestedLocation: { locationId: "a0101", locationCode: "A-01-01" },
          },
        ],
      },
      locations: [a0101],
      lots: [
        { locationId: "a0101", sku: "GLUE", lotCode: "LOT-OLD", qty: 2, expiresOn: 20261001 },
        { locationId: "a0101", sku: "GLUE", lotCode: "LOT-NEW", qty: 8, expiresOn: 20270301 },
      ],
    });
    expect(doc.stops[0]?.skus[0]?.lots.map((row) => row.lotCode)).toEqual(["LOT-OLD", "LOT-NEW"]);
  });

  it("labels dual UoM when the pick qty converts cleanly", () => {
    expect(formatPickUom(24, "ea", "cs", 12)).toBe("24 ea · 2 cs");
    expect(formatPickUom(13, "ea", "cs", 12)).toBeNull();
    const doc = buildOrderPickList({
      order: {
        number: "ORD-3",
        customerName: "Harbor",
        status: "open",
        source: "shopify",
        shopifyOrderName: "#1004",
        shipToCity: "Portland",
        shipToRegion: "OR",
        lines: [
          {
            lineId: "l1",
            sku: "BULB",
            itemName: "LED bulb",
            barcode: "BC-BULB",
            remaining: 24,
            qtyOrdered: 24,
            qtyPicked: 0,
            stockUom: "ea",
            altUom: "cs",
            altPerStock: 12,
            suggestedLocation: { locationId: "a0102", locationCode: "A-01-02" },
          },
        ],
      },
      locations: [a0102],
    });
    expect(doc.shipTo).toBe("Portland, OR");
    expect(doc.shopifyOrderName).toBe("#1004");
    expect(doc.stops[0]?.skus[0]?.uomLabel).toBe("24 ea · 2 cs");
    expect(doc.stops[0]?.skus[0]?.barcode).toBe("BC-BULB");
    expect(doc.reservationNote).toBe("suggested");
  });
});

describe("buildWavePickList", () => {
  it("splits a batch grab across member orders at the same bay", () => {
    const shade = (id: string, number: string, remaining: number) => ({
      number,
      customerName: number,
      status: "open" as const,
      lines: [
        {
          lineId: id,
          sku: "SHADE",
          itemName: "Shade",
          remaining,
          qtyOrdered: remaining,
          qtyPicked: 0,
          suggestedLocation: { locationId: "a0102", locationCode: "A-01-02" },
        },
      ],
    });
    const doc = buildWavePickList({
      wave: { number: "WAV-DEMO1", mode: "batch", status: "released" },
      orders: [shade("l1", "ORD-WAVE1", 4), shade("l2", "ORD-WAVE2", 4)],
      locations: [a0102],
    });
    expect(doc.stops).toHaveLength(1);
    expect(doc.stops[0]?.skus).toHaveLength(1);
    expect(doc.stops[0]?.skus[0]?.pickQty).toBe(8);
    expect(doc.stops[0]?.skus[0]?.orderSplits).toEqual([
      { orderNumber: "ORD-WAVE1", qty: 4 },
      { orderNumber: "ORD-WAVE2", qty: 4 },
    ]);
    expect(doc.walkStrip).toBe("A-01-02");
    expect(doc.orders).toEqual([]);
  });

  it("keeps per-order walks in wave mode", () => {
    const doc = buildWavePickList({
      wave: { number: "WAV-2", mode: "wave", status: "picking", notes: "Zone A" },
      orders: [
        {
          number: "ORD-A",
          customerName: "Acme",
          status: "picking",
          lines: [
            {
              lineId: "l1",
              sku: "SHADE",
              itemName: "Shade",
              remaining: 1,
              qtyOrdered: 1,
              qtyPicked: 0,
              suggestedLocation: { locationId: "a0101", locationCode: "A-01-01" },
            },
          ],
        },
        {
          number: "ORD-B",
          customerName: "Beta",
          status: "open",
          lines: [
            {
              lineId: "l2",
              sku: "LAMP",
              itemName: "Lamp",
              remaining: 1,
              qtyOrdered: 1,
              qtyPicked: 0,
              suggestedLocation: { locationId: "b0101", locationCode: "B-01-01" },
            },
          ],
        },
      ],
      locations: [a0101, b0101],
    });
    expect(doc.orders.map((order) => order.number)).toEqual(["ORD-A", "ORD-B"]);
    expect(doc.walkStrip).toBe("A-01-01 → B-01-01");
    expect(doc.stopCount).toBe(2);
    expect(doc.stops).toEqual([]);
  });
});

describe("identity helpers", () => {
  it("falls back to the first address line", () => {
    expect(formatShipToIdentity({ shipToAddress: "  12 Dock St\nPortland" })).toBe("12 Dock St");
    expect(formatWalkStrip(["A-01-01", "B-01-01"])).toBe("A-01-01 → B-01-01");
  });
});
