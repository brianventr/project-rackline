import { describe, expect, it } from "vitest";
import {
  WarrantyError,
  addMonthsUtc,
  assignmentIdsToStamp,
  inheritWarranty,
  internationalLabelBlock,
  kitLabelSerial,
  klaviyoEventBody,
  parseReturnGrade,
  parseSerialFallbackCsv,
  reconcileSerials,
  refurbTarget,
  serialsForPack,
  shopifySerialMetafields,
  warrantyFromTerm,
  KLAVIYO_METRICS,
} from "./warranty";

describe("warranty window", () => {
  it("starts at the ship date and ends after the SKU term", () => {
    const shipped = Date.UTC(2026, 1, 15);
    const view = warrantyFromTerm(shipped, 12, Date.UTC(2026, 6, 1));
    expect(view.eligible).toBe(true);
    expect(view.status).toBe("active");
    expect(view.start).toBe(shipped);
    expect(new Date(view.end!).toISOString().slice(0, 10)).toBe("2027-02-15");
  });

  it("treats a blank term as ineligible", () => {
    expect(warrantyFromTerm(Date.now(), null, Date.now())).toEqual({
      eligible: false,
      status: "none",
      start: null,
      end: null,
      termMonths: null,
    });
    expect(warrantyFromTerm(Date.now(), 0, Date.now()).eligible).toBe(false);
  });

  it("expires after the end date", () => {
    const shipped = Date.UTC(2024, 0, 1);
    const view = warrantyFromTerm(shipped, 12, Date.UTC(2026, 0, 2));
    expect(view.status).toBe("expired");
    expect(view.eligible).toBe(false);
  });

  it("clamps month-end dates", () => {
    expect(new Date(addMonthsUtc(Date.UTC(2026, 0, 31), 1)).toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});

describe("inherited warranty", () => {
  it("copies the original end and does not restart the term", () => {
    const start = Date.UTC(2026, 0, 1);
    const end = Date.UTC(2027, 0, 1);
    const view = inheritWarranty({ start, end, status: "void" }, Date.UTC(2026, 6, 1));
    expect(view.end).toBe(end);
    expect(view.start).toBe(start);
    expect(view.eligible).toBe(true);
    expect(view.end! - Date.UTC(2026, 6, 1)).toBeLessThan(end - start);
  });

  it("stays ineligible when the original had no term", () => {
    expect(inheritWarranty({ start: null, end: null, status: "none" }, Date.now()).status).toBe("none");
  });
});

describe("pack serials", () => {
  it("waits when a serialized line has no scans yet", () => {
    expect(serialsForPack({ qty: 2, trackSerial: true, serials: [] })).toEqual([]);
  });

  it("requires the count to match and rejects a repeat", () => {
    expect(serialsForPack({ qty: 2, trackSerial: true, serials: ["a", "B"] })).toEqual(["A", "B"]);
    expect(() => serialsForPack({ qty: 2, trackSerial: true, serials: ["A"] })).toThrow(WarrantyError);
    expect(() => serialsForPack({ qty: 2, trackSerial: true, serials: ["A", "a"] })).toThrow(/Duplicate serial A/);
  });

  it("ignores serials on a SKU that is not serialized", () => {
    expect(serialsForPack({ qty: 1, trackSerial: false, serials: ["A"] })).toEqual([]);
  });
});

describe("reconciliation", () => {
  const line = {
    orderId: "o1",
    orderNumber: "ORD-1",
    lineId: "l1",
    sku: "PLANK",
    qty: 2,
    warehouseId: "wh",
  };

  it("lists a shipped unit with no serial, a duplicate, and an orphan", () => {
    const problems = reconcileSerials({
      lines: [line],
      assignments: [
        { serial: "SN-1", orderId: "o1", lineId: "l1" },
        { serial: "SN-1", orderId: "o2", lineId: "l9" },
      ],
      shippedWithoutOrder: [{ serial: "SN-9", warehouseId: "wh" }],
    });
    expect(problems.map((row) => row.kind)).toEqual(["missing_serial", "duplicate_serial", "orphan_serial"]);
    expect(problems[0]).toMatchObject({ assigned: 1, qty: 2 });
  });

  it("is quiet when every shipped unit has its own serial", () => {
    expect(
      reconcileSerials({
        lines: [{ ...line, qty: 1 }],
        assignments: [{ serial: "SN-1", orderId: "o1", lineId: "l1" }],
        shippedWithoutOrder: [],
      }),
    ).toEqual([]);
  });
});

describe("refurb target", () => {
  it("lands on the linked SKU and quarantines when there is no link", () => {
    expect(refurbTarget({ disposition: "refurb", itemId: "new", refurbItemId: "refurb" })).toEqual({
      itemId: "refurb",
      quarantine: false,
    });
    expect(refurbTarget({ disposition: "refurb", itemId: "new", refurbItemId: null })).toEqual({
      itemId: "new",
      quarantine: true,
    });
    expect(refurbTarget({ disposition: "restock", itemId: "new", refurbItemId: "refurb" }).itemId).toBe("new");
  });
});

describe("shipment stamp", () => {
  it("stamps a carton's serials before the order is finished, and loose serials only at the end", () => {
    const rows = [
      { id: "a", packageId: "box", shippedAt: null },
      { id: "b", packageId: null, shippedAt: null },
    ];
    expect(assignmentIdsToStamp(rows, { packageIds: ["box"], orderComplete: false })).toEqual(["a"]);
    expect(assignmentIdsToStamp(rows, { packageIds: ["box"], orderComplete: true })).toEqual(["a", "b"]);
  });
});

describe("events and labels", () => {
  it("builds the three Klaviyo metrics with order and serial properties", () => {
    const body = klaviyoEventBody({
      metric: KLAVIYO_METRICS.shipped,
      uniqueId: "ship-1",
      email: "ada@example.com",
      properties: { order: "ORD-1", serials: ["SN-1"] },
    }) as { data: { attributes: { metric: { data: { attributes: { name: string } } }; properties: { serials: string[] } } } };
    expect(body.data.attributes.metric.data.attributes.name).toBe("Shipped with serial");
    expect(body.data.attributes.properties.serials).toEqual(["SN-1"]);
    expect(KLAVIYO_METRICS.prepared).toBe("Order being prepared");
    expect(KLAVIYO_METRICS.returnReceived).toBe("Return received");
  });

  it("writes serials onto the order and the customer, and skips a missing owner", () => {
    expect(
      shopifySerialMetafields({ orderGid: "gid://shopify/Order/1", customerGid: null, serials: ["SN-1"] }),
    ).toEqual([
      {
        ownerId: "gid://shopify/Order/1",
        namespace: "rackline",
        key: "serials",
        type: "single_line_text_field",
        value: "SN-1",
      },
    ]);
  });

  it("prints the consumed component serial on a kit label", () => {
    expect(kitLabelSerial([null, "plank-9"])).toBe("PLANK-9");
    expect(kitLabelSerial([])).toBeNull();
  });

  it("parses a serial fallback CSV and rejects a duplicate", () => {
    const parsed = parseSerialFallbackCsv("order,sku,serial\nORD-1,PLANK,sn-1\nORD-1,PLANK,SN-1\n");
    expect(parsed.rows).toEqual([{ line: 2, orderNumber: "ORD-1", sku: "PLANK", serial: "SN-1" }]);
    expect(parsed.errors[0]).toMatch(/duplicate serial SN-1/);
  });
});

describe("international labels", () => {
  it("refuses a country other than the warehouse and allows a domestic or blank address", () => {
    expect(internationalLabelBlock("Canada", "US")?.code).toBe("INTERNATIONAL");
    expect(internationalLabelBlock("USA", "United States")).toBeNull();
    expect(internationalLabelBlock(null, "US")).toBeNull();
    expect(internationalLabelBlock("DE", null)).toBeNull();
  });
});

describe("grades", () => {
  it("accepts a, b, and c", () => {
    expect(parseReturnGrade("B")).toBe("b");
    expect(parseReturnGrade("")).toBeNull();
    expect(() => parseReturnGrade("d")).toThrow(WarrantyError);
  });
});
