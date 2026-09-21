import { describe, expect, it } from "vitest";
import { flightProgress, buildTrafficSnapshot, type TrafficOrderRow, type TrafficWarehouseRow } from "./traffic";

const portland: TrafficWarehouseRow = {
  id: "wh-1",
  name: "Main warehouse",
  city: "Portland",
  region: "OR",
  country: "US",
  lat: 45.5152,
  lng: -122.6784,
};

const lamp = { itemId: "item-lamp", sku: "LAMP", name: "Desk lamp", qty: 2 };
const bulb = { itemId: "item-bulb", sku: "LED-BULB", name: "LED bulb", qty: 4 };

function order(partial: Partial<TrafficOrderRow> & Pick<TrafficOrderRow, "id" | "number" | "status">): TrafficOrderRow {
  return {
    warehouseId: "wh-1",
    packedAt: null,
    shippedAt: null,
    carrierService: "ups_ground",
    trackingNumber: null,
    trackerStatus: null,
    shipToAddress: null,
    shipToCity: null,
    shipToRegion: null,
    shipToCountry: null,
    shipToLat: null,
    shipToLng: null,
    lines: [lamp],
    ...partial,
  };
}

describe("flightProgress", () => {
  it("is 0 at departure and 1 at ETA", () => {
    expect(flightProgress(100, 100, 200)).toBe(0);
    expect(flightProgress(200, 100, 200)).toBe(1);
    expect(flightProgress(150, 100, 200)).toBe(0.5);
  });
});

describe("buildTrafficSnapshot", () => {
  const now = Date.parse("2026-09-20T18:00:00Z");

  it("puts packed orders at the origin gate", () => {
    const snap = buildTrafficSnapshot({
      now,
      warehouses: [portland],
      horizon: "now",
      grain: "city",
      orders: [
        order({
          id: "o1",
          number: "ORD-GATE",
          status: "packed",
          packedAt: now - 3_600_000,
          shipToAddress: "Austin, TX 78701",
        }),
      ],
    });
    expect(snap.kpis.atGate).toBe(1);
    expect(snap.flights[0]?.status).toBe("at_gate");
    expect(snap.flights[0]?.position).toEqual({ lat: portland.lat, lng: portland.lng });
    expect(snap.destinations[0]).toMatchObject({ city: "Austin", region: "TX", country: "US", units: 2 });
  });

  it("interpolates in-flight packages and marks overdue as arrived estimate", () => {
    const snap = buildTrafficSnapshot({
      now,
      warehouses: [portland],
      horizon: "7d",
      grain: "region",
      orders: [
        order({
          id: "o2",
          number: "ORD-AIR",
          status: "shipped",
          shippedAt: now - 6 * 3_600_000,
          trackingNumber: "RL-AIR",
          shipToAddress: "New York, NY 10001",
        }),
        order({
          id: "o3",
          number: "ORD-ARRIVED",
          status: "shipped",
          shippedAt: now - 10 * 86_400_000,
          shipToAddress: "Boston, MA 02108",
          lines: [bulb],
        }),
      ],
    });
    const air = snap.flights.find((row) => row.number === "ORD-AIR");
    expect(air?.status).toBe("in_flight");
    expect(air?.progress).toBeGreaterThan(0);
    expect(air?.progress).toBeLessThan(1);
    expect(snap.flights.find((row) => row.number === "ORD-ARRIVED")).toBeUndefined();
    expect(snap.kpis.arrived).toBe(1);
    expect(snap.destinations.map((row) => row.region).sort()).toEqual(["MA", "NY"]);
  });

  it("filters heat and flights by SKU", () => {
    const snap = buildTrafficSnapshot({
      now,
      warehouses: [portland],
      horizon: "now",
      grain: "country",
      skuIds: ["item-bulb"],
      orders: [
        order({
          id: "o4",
          number: "ORD-LAMP",
          status: "packed",
          shipToAddress: "Miami, FL 33101",
        }),
        order({
          id: "o5",
          number: "ORD-BULB",
          status: "packed",
          shipToAddress: "Chicago, IL 60601",
          lines: [bulb],
        }),
      ],
    });
    expect(snap.flights.map((row) => row.number)).toEqual(["ORD-BULB"]);
    expect(snap.destinations).toHaveLength(1);
    expect(snap.destinations[0]?.skus[0]?.sku).toBe("LED-BULB");
  });

  it("records unmapped destinations as exceptions", () => {
    const snap = buildTrafficSnapshot({
      now,
      warehouses: [portland],
      horizon: "now",
      grain: "city",
      orders: [
        order({
          id: "o6",
          number: "ORD-WILLCALL",
          status: "shipped",
          shippedAt: now - 3_600_000,
          shipToAddress: "Will call",
        }),
      ],
    });
    expect(snap.exceptions).toEqual([{ orderId: "o6", number: "ORD-WILLCALL", reason: "unmapped_dest" }]);
    expect(snap.flights).toHaveLength(0);
  });

  it("prefers tracker status over the geodesic lane estimate", () => {
    const tracked = buildTrafficSnapshot({
      now,
      warehouses: [portland],
      horizon: "7d",
      grain: "city",
      orders: [
        order({
          id: "o7",
          number: "ORD-TRACK",
          status: "shipped",
          shippedAt: now - 10 * 86_400_000,
          trackingNumber: "EZ-LIVE",
          trackerStatus: "in_transit",
          shipToAddress: "Boston, MA 02108",
        }),
        order({
          id: "o8",
          number: "ORD-DELIVERED",
          status: "shipped",
          shippedAt: now - 2 * 3_600_000,
          trackingNumber: "EZ-DONE",
          trackerStatus: "delivered",
          shipToAddress: "Austin, TX 78701",
        }),
        order({
          id: "o9",
          number: "ORD-DEMO",
          status: "shipped",
          shippedAt: now - 6 * 3_600_000,
          trackingNumber: "RL-DEMO",
          trackerStatus: null,
          shipToAddress: "New York, NY 10001",
        }),
      ],
    });
    expect(tracked.flights.find((row) => row.number === "ORD-TRACK")?.status).toBe("in_flight");
    expect(tracked.flights.find((row) => row.number === "ORD-DELIVERED")).toBeUndefined();
    expect(tracked.kpis.arrived).toBe(1);
    expect(tracked.flights.find((row) => row.number === "ORD-DEMO")?.status).toBe("in_flight");
  });

  it("lists tracker failures as exceptions instead of geodesic flights", () => {
    const snap = buildTrafficSnapshot({
      now,
      warehouses: [portland],
      horizon: "7d",
      grain: "city",
      orders: [
        order({
          id: "o10",
          number: "ORD-FAIL",
          status: "shipped",
          shippedAt: now - 8 * 3_600_000,
          trackingNumber: "1Z-FAIL",
          trackerStatus: "failure",
          shipToAddress: "Miami, FL 33127",
        }),
      ],
    });
    expect(snap.flights.find((row) => row.number === "ORD-FAIL")).toBeUndefined();
    expect(snap.kpis.exceptions).toBe(1);
    expect(snap.exceptions).toEqual([{ orderId: "o10", number: "ORD-FAIL", reason: "tracker_exception" }]);
  });
});
