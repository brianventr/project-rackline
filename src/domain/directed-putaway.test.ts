import { describe, expect, it } from "vitest";
import {
  baysForItem,
  shouldSuggestPutaway,
  suggestPutawayBay,
  suggestPutawayJobs,
} from "./directed-putaway";

const recv = {
  locationId: "recv",
  locationCode: "RECV",
  locationName: "Dock",
  barcode: "RECV",
  type: "receiving",
  slotRole: "none",
  aisle: null,
  qty: 12,
};

const bulk = {
  locationId: "a0101",
  locationCode: "A-01-01",
  locationName: "Aisle A bulk",
  barcode: "A-01-01",
  type: "storage",
  slotRole: "bulk",
  aisle: "A",
  qty: 40,
};

const pickFace = {
  locationId: "a0102",
  locationCode: "A-01-02",
  locationName: "Aisle A pick",
  barcode: "A-01-02",
  type: "storage",
  slotRole: "pick",
  aisle: "A",
  qty: 6,
};

const otherBulk = {
  locationId: "b0101l2",
  locationCode: "B-01-01-2",
  locationName: "Aisle B bulk",
  barcode: "B-01-01-2",
  type: "storage",
  slotRole: "bulk",
  aisle: "B",
  qty: 0,
};

const ship = {
  locationId: "ship",
  locationCode: "SHIP",
  locationName: "Outbound",
  barcode: "SHIP",
  type: "shipping",
  slotRole: "none",
  aisle: null,
  qty: 0,
};

describe("shouldSuggestPutaway", () => {
  it("directs stock off dock, ship, and bench", () => {
    expect(shouldSuggestPutaway("receiving")).toBe(true);
    expect(shouldSuggestPutaway("shipping")).toBe(true);
    expect(shouldSuggestPutaway("production")).toBe(true);
    expect(shouldSuggestPutaway("storage")).toBe(false);
  });
});

describe("suggestPutawayBay", () => {
  it("prefers bulk that already holds the SKU", () => {
    expect(suggestPutawayBay([recv, pickFace, bulk, otherBulk], "recv")?.locationCode).toBe("A-01-01");
  });

  it("does not send putaway back to dock or ship", () => {
    expect(suggestPutawayBay([recv, ship], "recv")).toBeNull();
  });

  it("does not suggest the from bay", () => {
    expect(suggestPutawayBay([bulk], "a0101")).toBeNull();
  });

  it("prefers same-aisle bulk over a farther empty bulk", () => {
    const emptyHome = { ...bulk, qty: 0 };
    expect(suggestPutawayBay([pickFace, emptyHome, otherBulk], "recv")?.locationCode).toBe("A-01-01");
  });

  it("prefers empty bulk over empty pick", () => {
    expect(
      suggestPutawayBay(
        [
          { ...pickFace, qty: 0 },
          { ...otherBulk, qty: 0 },
        ],
        "recv",
      )?.locationCode,
    ).toBe("B-01-01-2");
  });
});

describe("suggestPutawayJobs", () => {
  it("skips storage-to-storage (that is replenish)", () => {
    expect(
      suggestPutawayJobs(
        { id: "a0101", code: "A-01-01", barcode: "A-01-01", type: "storage" },
        [{ itemId: "bulb", sku: "LED-BULB", itemName: "LED", qty: 12 }],
        new Map([["bulb", [bulk, pickFace]]]),
      ),
    ).toEqual([]);
  });

  it("suggests a bay per SKU on the dock", () => {
    const jobs = suggestPutawayJobs(
      { id: "recv", code: "RECV", barcode: "RECV", type: "receiving" },
      [
        { itemId: "bulb", sku: "LED-BULB", itemName: "LED", qty: 12 },
        { itemId: "shade", sku: "SHADE", itemName: "Shade", qty: 6 },
      ],
      new Map([
        ["bulb", [recv, bulk, pickFace]],
        ["shade", [recv, { ...bulk, qty: 20 }, { ...otherBulk, locationCode: "A-02-01", locationId: "a0201", aisle: "A", slotRole: "none", qty: 4 }]],
      ]),
    );
    expect(jobs.map((job) => [job.sku, job.suggested?.locationCode])).toEqual([
      ["LED-BULB", "A-01-01"],
      ["SHADE", "A-01-01"],
    ]);
  });
});

describe("baysForItem", () => {
  it("fills qty onto every warehouse bay", () => {
    const bays = baysForItem(
      [recv, bulk, pickFace].map(({ qty: _qty, ...location }) => location),
      [
        { locationId: "recv", itemId: "bulb", qty: 12 },
        { locationId: "a0101", itemId: "bulb", qty: 40 },
        { locationId: "a0101", itemId: "shade", qty: 20 },
      ],
      "bulb",
    );
    expect(bays.find((row) => row.locationCode === "A-01-01")?.qty).toBe(40);
    expect(bays.find((row) => row.locationCode === "A-01-02")?.qty).toBe(0);
  });
});
