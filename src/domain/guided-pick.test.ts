import { describe, expect, it } from "vitest";
import {
  appendSerial,
  clampPickQty,
  lineRemaining,
  nextStopKey,
  pickBayFor,
  pickStops,
  routeGuidedScan,
  stopCounter,
  stopIndex,
  stopKey,
  stopPickBody,
  stopProgress,
  withPickBay,
  type GuidedPickLine,
  type PickStop,
} from "./guided-pick";

const a0101 = { id: "a0101", code: "A-01-01", aisle: "A", rack: "01", bay: "01", level: 1 };
const a0101l2 = { id: "a0101l2", code: "A-01-01-2", aisle: "A", rack: "01", bay: "01", level: 2 };
const a0102 = { id: "a0102", code: "A-01-02", aisle: "A", rack: "01", bay: "02", level: 1 };
const b0101 = { id: "b0101", code: "B-01-01", aisle: "B", rack: "01", bay: "01", level: 1 };
const locations = [b0101, a0102, a0101l2, a0101];

function line(partial: Partial<GuidedPickLine> & { id: string; sku: string }): GuidedPickLine {
  return { itemName: `${partial.sku} name`, qty: 1, qtyPicked: 0, ...partial };
}

const at = (id: string, code: string) => ({ locationId: id, locationCode: code });

describe("pickStops", () => {
  it("walks aisle, rack, bay, then level, and skips picked lines", () => {
    const stops = pickStops(
      [
        line({ id: "l1", sku: "LAMP", qty: 2, remaining: 2, suggestedLocation: at("b0101", "B-01-01") }),
        line({ id: "l2", sku: "SHADE", qty: 1, remaining: 1, suggestedLocation: at("a0101l2", "A-01-01-2") }),
        line({ id: "l3", sku: "BASE", qty: 3, qtyPicked: 3, remaining: 0, suggestedLocation: at("a0101", "A-01-01") }),
        line({ id: "l4", sku: "BULB", qty: 4, remaining: 4, suggestedLocation: at("a0102", "A-01-02") }),
        line({ id: "l5", sku: "CORD", qty: 1, remaining: 1, suggestedLocation: at("a0101", "A-01-01") }),
      ],
      locations,
    );
    expect(stops.map((stop) => `${stop.locationCode}:${stop.sku}×${stop.qty}`)).toEqual([
      "A-01-01:CORD×1",
      "A-01-01-2:SHADE×1",
      "A-01-02:BULB×4",
      "B-01-01:LAMP×2",
    ]);
  });

  it("matches the pick map's walk when several lines share a bay", () => {
    const stops = pickStops(
      [
        line({ id: "l1", sku: "LAMP", remaining: 1, suggestedLocation: at("a0102", "A-01-02") }),
        line({ id: "l2", sku: "SHADE", remaining: 2, suggestedLocation: at("a0102", "A-01-02") }),
      ],
      locations,
    );
    expect(stops.map((stop) => stop.lineId)).toEqual(["l1", "l2"]);
    expect(stops.every((stop) => stop.locationId === "a0102")).toBe(true);
  });

  it("splits a line across reserved bays and ignores the suggestion", () => {
    const stops = pickStops(
      [
        line({
          id: "l1",
          sku: "LAMP",
          qty: 5,
          remaining: 5,
          suggestedLocation: at("a0101", "A-01-01"),
          allocations: [
            { ...at("b0101", "B-01-01"), qty: 2 },
            { ...at("a0102", "A-01-02"), qty: 3 },
            { ...at("a0101l2", "A-01-01-2"), qty: 0 },
          ],
        }),
      ],
      locations,
    );
    expect(stops.map((stop) => `${stop.locationCode}:${stop.qty}`)).toEqual(["A-01-02:3", "B-01-01:2"]);
  });

  it("sends qty the reservations do not cover to the suggested bay, or to no bay", () => {
    const suggested = pickStops(
      [
        line({
          id: "l1",
          sku: "LAMP",
          qty: 5,
          remaining: 5,
          suggestedLocation: at("a0101", "A-01-01"),
          allocations: [{ ...at("b0101", "B-01-01"), qty: 2 }],
        }),
      ],
      locations,
    );
    expect(suggested.map((stop) => `${stop.locationCode}:${stop.qty}`)).toEqual(["A-01-01:3", "B-01-01:2"]);

    const none = pickStops(
      [line({ id: "l1", sku: "LAMP", qty: 5, remaining: 5, allocations: [{ ...at("b0101", "B-01-01"), qty: 2 }] })],
      locations,
    );
    expect(none.map((stop) => `${stop.locationCode}:${stop.qty}`)).toEqual(["B-01-01:2", "null:3"]);
  });

  it("merges leftover qty into a reserved stop at the same bay", () => {
    const stops = pickStops(
      [
        line({
          id: "l1",
          sku: "LAMP",
          qty: 4,
          remaining: 4,
          suggestedLocation: at("b0101", "B-01-01"),
          allocations: [{ ...at("b0101", "B-01-01"), qty: 1 }],
        }),
      ],
      locations,
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ locationId: "b0101", qty: 4 });
  });

  it("never asks for more than the line has left when a reservation is stale", () => {
    const stops = pickStops(
      [
        line({
          id: "l1",
          sku: "LAMP",
          qty: 3,
          qtyPicked: 2,
          remaining: 1,
          allocations: [
            { ...at("a0102", "A-01-02"), qty: 3 },
            { ...at("b0101", "B-01-01"), qty: 2 },
          ],
        }),
      ],
      locations,
    );
    expect(stops.map((stop) => `${stop.locationCode}:${stop.qty}`)).toEqual(["A-01-02:1"]);
  });

  it("asks the suggested bay for no more than it holds and sends the rest to no bay", () => {
    // Unstarted order, 4 CORD wanted, the best bay holds 3: the first screen must not ask for 4 there.
    const stops = pickStops(
      [line({ id: "l1", sku: "CORD", qty: 4, remaining: 4, suggestedLocation: { ...at("a0101", "A-01-01"), qty: 3 } })],
      locations,
    );
    expect(stops.map((stop) => `${stop.locationCode}:${stop.qty}`)).toEqual(["A-01-01:3", "null:1"]);
  });

  it("uses the whole line at the suggested bay when it holds enough", () => {
    const stops = pickStops(
      [line({ id: "l1", sku: "CORD", qty: 4, remaining: 4, suggestedLocation: { ...at("a0101", "A-01-01"), qty: 9 } })],
      locations,
    );
    expect(stops.map((stop) => `${stop.locationCode}:${stop.qty}`)).toEqual(["A-01-01:4"]);
  });

  it("sends everything to no bay when the suggested bay has nothing to give", () => {
    for (const qty of [0, -2]) {
      const stops = pickStops(
        [line({ id: "l1", sku: "CORD", qty: 2, remaining: 2, suggestedLocation: { ...at("a0101", "A-01-01"), qty } })],
        locations,
      );
      expect(stops.map((stop) => `${stop.locationCode}:${stop.qty}`)).toEqual(["null:2"]);
    }
  });

  it("counts this order's own reservation at the suggested bay against what that bay can give", () => {
    // The API's qty is stock less OTHER orders' reservations, so the 1 reserved here is inside the 2.
    const stops = pickStops(
      [
        line({
          id: "l1",
          sku: "LAMP",
          qty: 4,
          remaining: 4,
          suggestedLocation: { ...at("b0101", "B-01-01"), qty: 2 },
          allocations: [{ ...at("b0101", "B-01-01"), qty: 1 }],
        }),
      ],
      locations,
    );
    expect(stops.map((stop) => `${stop.locationCode}:${stop.qty}`)).toEqual(["B-01-01:2", "null:2"]);
  });

  it("puts lines with no bay last, in line order", () => {
    const stops = pickStops(
      [
        line({ id: "l1", sku: "LAMP", remaining: 2 }),
        line({ id: "l2", sku: "SHADE", remaining: 1, suggestedLocation: at("b0101", "B-01-01") }),
        line({ id: "l3", sku: "BASE", remaining: 1 }),
      ],
      locations,
    );
    expect(stops.map((stop) => `${stop.sku}@${stop.locationCode}`)).toEqual(["SHADE@B-01-01", "LAMP@null", "BASE@null"]);
    expect(stops[1]).toMatchObject({ locationId: null, locationCode: null, qty: 2 });
  });

  it("carries the photo and the lot, serial, and weight flags", () => {
    const [stop] = pickStops(
      [
        line({
          id: "l1",
          sku: "LAMP",
          itemName: "Desk lamp",
          imageUrl: "/demo-sku/LAMP.svg",
          remaining: 2,
          trackSerial: true,
          catchWeight: null,
          suggestedLocation: at("b0101", "B-01-01"),
        }),
      ],
      locations,
    );
    expect(stop).toEqual<PickStop>({
      lineId: "l1",
      sku: "LAMP",
      itemName: "Desk lamp",
      imageUrl: "/demo-sku/LAMP.svg",
      qty: 2,
      locationId: "b0101",
      locationCode: "B-01-01",
      trackLot: false,
      trackSerial: true,
      catchWeight: false,
    });
  });

  it("uses the current bay code and falls back to the reserved code for bays it does not know", () => {
    const stops = pickStops(
      [
        line({ id: "l1", sku: "LAMP", remaining: 1, suggestedLocation: at("b0101", "OLD-CODE") }),
        line({ id: "l2", sku: "SHADE", remaining: 1, suggestedLocation: at("gone", "Z-99-99") }),
      ],
      locations,
    );
    expect(stops.map((stop) => stop.locationCode)).toEqual(["B-01-01", "Z-99-99"]);
  });

  it("walks known bays, then bays it does not know, then qty with no bay", () => {
    const stops = pickStops(
      [
        line({ id: "l1", sku: "CORD", remaining: 1, suggestedLocation: at("gone", "Z-99-99") }),
        line({ id: "l2", sku: "BASE", remaining: 1 }),
        line({ id: "l3", sku: "LAMP", remaining: 1, suggestedLocation: at("b0101", "B-01-01") }),
        line({ id: "l4", sku: "BULB", remaining: 1, allocations: [{ ...at("old", "A-00-00"), qty: 1 }] }),
        line({ id: "l5", sku: "SHADE", remaining: 1, suggestedLocation: at("a0102", "A-01-02") }),
      ],
      locations,
    );
    // Unknown bays keep the map's order among themselves (A-00-00 before Z-99-99 by code).
    expect(stops.map((stop) => `${stop.sku}@${stop.locationCode}`)).toEqual([
      "SHADE@A-01-02",
      "LAMP@B-01-01",
      "BULB@A-00-00",
      "CORD@Z-99-99",
      "BASE@null",
    ]);
  });

  it("works out remaining from qty and picked when the server leaves it off", () => {
    expect(lineRemaining({ qty: 5, qtyPicked: 2 })).toBe(3);
    expect(lineRemaining({ qty: 2, qtyPicked: 3 })).toBe(0);
    expect(lineRemaining({ qty: 5, qtyPicked: 0, remaining: 1 })).toBe(1);
    const stops = pickStops([line({ id: "l1", sku: "LAMP", qty: 4, qtyPicked: 1, suggestedLocation: at("a0101", "A-01-01") })], locations);
    expect(stops[0]?.qty).toBe(3);
  });

  it("returns nothing when every line is picked", () => {
    expect(pickStops([line({ id: "l1", sku: "LAMP", qty: 2, qtyPicked: 2, remaining: 0 })], locations)).toEqual([]);
  });
});

describe("stopProgress", () => {
  it("counts lines, not units", () => {
    expect(
      stopProgress([
        { qty: 40, qtyPicked: 0, remaining: 40 },
        { qty: 1, qtyPicked: 1, remaining: 0 },
        { qty: 1, qtyPicked: 1, remaining: 0 },
        { qty: 2, qtyPicked: 1, remaining: 1 },
      ]),
    ).toEqual({ done: 2, total: 4 });
  });

  it("ignores zero-qty lines and handles an empty order", () => {
    expect(stopProgress([{ qty: 0, qtyPicked: 0, remaining: 0 }, { qty: 1, qtyPicked: 1 }])).toEqual({ done: 1, total: 1 });
    expect(stopProgress([])).toEqual({ done: 0, total: 0 });
  });
});

describe("stop navigation", () => {
  const stops = pickStops(
    [
      line({ id: "l1", sku: "LAMP", remaining: 1, suggestedLocation: at("a0101", "A-01-01") }),
      line({ id: "l2", sku: "SHADE", remaining: 1, suggestedLocation: at("a0102", "A-01-02") }),
      line({ id: "l3", sku: "BASE", remaining: 1 }),
    ],
    locations,
  );

  it("keys a stop by line and bay", () => {
    expect(stops.map(stopKey)).toEqual(["l1@a0101", "l2@a0102", "l3@-"]);
  });

  it("finds a stop by key and falls back to the first", () => {
    expect(stopIndex(stops, "l2@a0102")).toBe(1);
    expect(stopIndex(stops, "gone@x")).toBe(0);
    expect(stopIndex(stops, null)).toBe(0);
  });

  it("stays on the same line when its stop moved to another bay", () => {
    // Starting the pick re-plans SHADE from its suggested bay onto the bay it was reserved at.
    expect(stopIndex(stops, "l2@b0101")).toBe(1);
    expect(stopIndex(stops, "l3@a0101")).toBe(2);
    expect(stopIndex(stops, "l2")).toBe(0);
  });

  it("skips forward and wraps so skipped stops come round again", () => {
    expect(nextStopKey(stops, "l1@a0101")).toBe("l2@a0102");
    expect(nextStopKey(stops, "l3@-")).toBe("l1@a0101");
    expect(nextStopKey(stops, null)).toBe("l1@a0101");
    expect(nextStopKey([], "l1@a0101")).toBeNull();
  });

  it("counts picked lines as stops behind the picker", () => {
    const lines = [
      { qty: 1, qtyPicked: 1, remaining: 0 },
      { qty: 1, qtyPicked: 0, remaining: 1 },
      { qty: 1, qtyPicked: 0, remaining: 1 },
      { qty: 1, qtyPicked: 0, remaining: 1 },
    ];
    expect(stopCounter(lines, stops, 0)).toEqual({ current: 2, total: 4 });
    expect(stopCounter(lines, stops, 2)).toEqual({ current: 4, total: 4 });
    expect(stopCounter(lines, stops, 9)).toEqual({ current: 4, total: 4 });
    expect(stopCounter([{ qty: 2, qtyPicked: 2, remaining: 0 }], [], 0)).toEqual({ current: 1, total: 1 });
  });
});

describe("clampPickQty", () => {
  it("keeps qty between zero and what is left", () => {
    expect(clampPickQty("3", 5)).toBe(3);
    expect(clampPickQty("9", 5)).toBe(5);
    expect(clampPickQty(-1, 5)).toBe(0);
    expect(clampPickQty("", 5)).toBe(0);
    expect(clampPickQty("abc", 5)).toBe(0);
    expect(clampPickQty("2.7", 5)).toBe(2);
  });
});

describe("routeGuidedScan", () => {
  const stops = pickStops(
    [
      line({ id: "l1", sku: "LAMP", remaining: 1, suggestedLocation: at("a0101", "A-01-01") }),
      line({ id: "l2", sku: "SHADE", remaining: 1, suggestedLocation: at("a0102", "A-01-02") }),
      line({ id: "l3", sku: "BASE", remaining: 1, suggestedLocation: at("a0101", "A-01-01") }),
      line({ id: "l4", sku: "CORD", remaining: 1 }),
    ],
    locations,
  );
  // Walk: A-01-01 LAMP, A-01-01 BASE, A-01-02 SHADE, no bay CORD.

  it("confirms the bay of the current stop", () => {
    expect(routeGuidedScan(stops, 0, { kind: "location", locationId: "a0101" })).toEqual({
      type: "bay",
      index: 0,
      jumped: false,
    });
  });

  it("jumps forward to the next stop at a scanned bay", () => {
    expect(routeGuidedScan(stops, 0, { kind: "location", locationId: "a0102" })).toEqual({
      type: "bay",
      index: 2,
      jumped: true,
    });
    expect(routeGuidedScan(stops, 2, { kind: "location", locationId: "a0101" })).toEqual({
      type: "bay",
      index: 0,
      jumped: true,
    });
  });

  it("rejects a bay with nothing to pick and names the right one", () => {
    expect(routeGuidedScan(stops, 0, { kind: "location", locationId: "b0101" })).toEqual({
      type: "wrong-bay",
      expected: "A-01-01",
    });
  });

  it("confirms the bay the picker chose instead of the suggested one", () => {
    expect(routeGuidedScan(stops, 0, { kind: "location", locationId: "b0101" }, "b0101")).toMatchObject({
      type: "bay",
      index: 0,
    });
  });

  it("keeps the picker on the current stop when they scan its own bay after choosing another", () => {
    // Stop 0 (LAMP, A-01-01) was moved to B-01-01 with "Other bay"; a later stop (BASE) is also at A-01-01.
    expect(routeGuidedScan(stops, 0, { kind: "location", locationId: "a0101" }, "b0101")).toEqual({
      type: "bay",
      index: 0,
      jumped: false,
    });
    // And from a stop whose own bay is the only one at that address.
    expect(routeGuidedScan(stops, 2, { kind: "location", locationId: "a0102" }, "b0101")).toEqual({
      type: "bay",
      index: 2,
      jumped: false,
    });
  });

  it("names the chosen bay, not the suggested one, when the scan is wrong", () => {
    expect(routeGuidedScan(stops, 2, { kind: "location", locationId: "b0101" }, "a0101l2")).toEqual({
      type: "wrong-bay",
      expected: "A-01-02",
    });
  });

  it("lets a stop with no bay take the scanned bay", () => {
    expect(routeGuidedScan(stops, 3, { kind: "location", locationId: "a0102" })).toEqual({ type: "choose-bay", index: 3 });
  });

  it("confirms the SKU, jumps to it, or says it is not on the order", () => {
    expect(routeGuidedScan(stops, 0, { kind: "item", sku: "lamp" })).toEqual({ type: "item", index: 0, jumped: false });
    expect(routeGuidedScan(stops, 0, { kind: "item", sku: "SHADE" })).toEqual({ type: "item", index: 2, jumped: true });
    expect(routeGuidedScan(stops, 0, { kind: "item", sku: "BULB" })).toEqual({ type: "not-on-order" });
  });

  it("handles an empty walk", () => {
    expect(routeGuidedScan([], 0, { kind: "item", sku: "LAMP" })).toEqual({ type: "not-on-order" });
    expect(routeGuidedScan([], 0, { kind: "location", locationId: "a0101" })).toEqual({ type: "wrong-bay", expected: null });
  });
});

describe("pick bay", () => {
  const stops = pickStops(
    [
      line({ id: "l1", sku: "LAMP", remaining: 1, suggestedLocation: at("a0101", "A-01-01") }),
      line({ id: "l2", sku: "SHADE", remaining: 1, suggestedLocation: at("a0102", "A-01-02") }),
      line({ id: "l3", sku: "CORD", remaining: 1 }),
    ],
    locations,
  );
  const [lamp, shade, cord] = stops as [PickStop, PickStop, PickStop];

  it("uses the other-bay choice, else the stop's own bay", () => {
    expect(pickBayFor({}, lamp)).toBe("a0101");
    expect(pickBayFor({ "l1@a0101": "b0101" }, lamp)).toBe("b0101");
    expect(pickBayFor({}, cord)).toBeNull();
  });

  it("drops the other-bay choice when the picker scans the stop's own bay", () => {
    // Other bay → B-01-01, then the picker scans A-01-01 (the stop's suggested bay).
    let overrides = withPickBay({}, lamp, "b0101");
    expect(pickBayFor(overrides, lamp)).toBe("b0101");
    const result = routeGuidedScan(stops, 0, { kind: "location", locationId: "a0101" }, pickBayFor(overrides, lamp));
    expect(result).toEqual({ type: "bay", index: 0, jumped: false });
    overrides = withPickBay(overrides, stops[0]!, "a0101");
    expect(overrides).toEqual({});
    expect(pickBayFor(overrides, lamp)).toBe("a0101");
    const body = stopPickBody({ locationId: pickBayFor(overrides, lamp)!, lineId: lamp.lineId, qty: 1 });
    expect(body.locationId).toBe("a0101");
  });

  it("keeps the other-bay choice when the picker scans that bay", () => {
    const overrides = withPickBay({}, lamp, "b0101");
    const result = routeGuidedScan(stops, 0, { kind: "location", locationId: "b0101" }, pickBayFor(overrides, lamp));
    expect(result).toEqual({ type: "bay", index: 0, jumped: false });
    expect(withPickBay(overrides, lamp, "b0101")).toBe(overrides);
  });

  it("drops a later stop's other-bay choice when a scan jumps to its own bay", () => {
    const overrides = withPickBay({}, shade, "b0101");
    const result = routeGuidedScan(stops, 0, { kind: "location", locationId: "a0102" }, pickBayFor(overrides, lamp));
    expect(result).toEqual({ type: "bay", index: 1, jumped: true });
    expect(pickBayFor(withPickBay(overrides, stops[1]!, "a0102"), shade)).toBe("a0102");
  });

  it("gives a stop with no bay the scanned bay, and clears it when blanked", () => {
    const overrides = withPickBay({}, cord, "a0102");
    expect(overrides).toEqual({ "l3@-": "a0102" });
    expect(withPickBay(overrides, cord, null)).toEqual({});
    expect(withPickBay({}, lamp, null)).toEqual({});
  });
});

describe("stopPickBody", () => {
  it("posts one line in the same shape as the list-mode pick", () => {
    const body = stopPickBody({ locationId: "b0101", lineId: "l1", qty: 2, lotCode: "", serials: "SN1, SN2", weightGrams: undefined });
    expect(body).toEqual({
      locationId: "b0101",
      lines: [{ lineId: "l1", qty: 2, lotCode: undefined, serials: "SN1, SN2", weightGrams: undefined }],
    });
    expect(JSON.parse(JSON.stringify(body))).toEqual({
      locationId: "b0101",
      lines: [{ lineId: "l1", qty: 2, serials: "SN1, SN2" }],
    });
  });

  it("keeps lot and weight when given", () => {
    expect(stopPickBody({ locationId: "a", lineId: "l1", qty: 1, lotCode: "LOT-9", weightGrams: 450 }).lines[0]).toEqual({
      lineId: "l1",
      qty: 1,
      lotCode: "LOT-9",
      serials: undefined,
      weightGrams: 450,
    });
  });
});

describe("appendSerial", () => {
  it("adds a new serial and ignores repeats", () => {
    expect(appendSerial("", "SN1")).toBe("SN1");
    expect(appendSerial("SN1", "SN2")).toBe("SN1, SN2");
    expect(appendSerial("SN1, SN2", "SN2")).toBe("SN1, SN2");
    expect(appendSerial("SN1\nSN2", " ")).toBe("SN1\nSN2");
  });
});
