import { describe, expect, it } from "vitest";
import { InsufficientStockError } from "./inventory";
import {
  allocateLooseFirstLots,
  allocateLooseFirstSerials,
  applyPlateOps,
  assertPlateCan,
  canPlate,
  drawFromPlate,
  isPlateCode,
  looseLots,
  looseQty,
  looseSerials,
  lotUnitsByExpiry,
  nextPlateCode,
  normalizePlateCode,
  overLooseText,
  parsePlateType,
  plateCode,
  PlateInputError,
  plateMoveLines,
  plateNumber,
  plateOverages,
  PlateOverLooseError,
  platedByKey,
  PlateShortError,
  PlateStateError,
  plateUnits,
  receiveOntoPlate,
  reconcilePlates,
  settlePlates,
  withPlateShare,
  type Plate,
} from "./license-plates";

const bay = "bay-a";
const other = "bay-b";

function plate(code: string, lines: Plate["lines"], extra: Partial<Plate> = {}): Plate {
  return { id: code, code, status: "open", locationId: bay, lines, ...extra };
}

function line(itemId: string, qty: number, lotCode: string | null = null, serial: string | null = null) {
  return { itemId, qty, lotCode, serial };
}

const names = {
  skus: new Map([
    ["shade", "SHADE"],
    ["bulb", "LED-BULB"],
    ["lamp", "LAMP"],
  ]),
  bays: new Map([
    [bay, "A-01-01"],
    [other, "B-01-01"],
  ]),
};

describe("plate codes", () => {
  it("pads to six digits", () => {
    expect(plateCode(123)).toBe("LP-000123");
    expect(plateCode(1_234_567)).toBe("LP-1234567");
  });

  it("reads typed and prefixed codes as the canonical one", () => {
    expect(normalizePlateCode("LP-000123")).toBe("LP-000123");
    expect(normalizePlateCode(" lp-123 ")).toBe("LP-000123");
    expect(normalizePlateCode("LP:123")).toBe("LP-000123");
    expect(normalizePlateCode("LP123")).toBeNull();
    expect(normalizePlateCode("LP-0")).toBeNull();
    expect(normalizePlateCode("LAMP")).toBeNull();
    expect(normalizePlateCode(null)).toBeNull();
    expect(isPlateCode("lp-7")).toBe(true);
    expect(isPlateCode("SKU:LP-7")).toBe(false);
  });

  it("numbers the next plate after the highest in use", () => {
    expect(nextPlateCode(null)).toBe("LP-000001");
    expect(nextPlateCode(41)).toBe("LP-000042");
    expect(plateNumber("LP-000042")).toBe(42);
    expect(plateNumber("BOX-1")).toBe(0);
  });

  it("defaults the type to a tote and refuses unknown ones", () => {
    expect(parsePlateType(undefined)).toBe("tote");
    expect(parsePlateType("pallet")).toBe("pallet");
    expect(() => parsePlateType("crate")).toThrow(PlateInputError);
  });
});

describe("plate status", () => {
  it("lets an open plate do anything but reopen", () => {
    const open = plate("LP-000001", []);
    expect(["build", "receive", "move", "pick", "break", "close"].every((action) => canPlate(open, action as never))).toBe(true);
    expect(canPlate(open, "reopen")).toBe(false);
  });

  it("keeps stock off a closed plate until it is reopened", () => {
    const closed = plate("LP-000002", [], { status: "closed" });
    expect(() => assertPlateCan(closed, "build")).toThrow("LP-000002 is closed. Reopen it to add stock.");
    expect(canPlate(closed, "move")).toBe(true);
    expect(canPlate(closed, "pick")).toBe(true);
    expect(canPlate(closed, "reopen")).toBe(true);
  });

  it("does nothing more with a shipped plate", () => {
    const shipped = plate("LP-000003", [], { status: "shipped", locationId: null });
    for (const action of ["build", "move", "pick", "break", "reopen"] as const) {
      expect(() => assertPlateCan(shipped, action)).toThrow(PlateStateError);
    }
    expect(() => assertPlateCan(shipped, "move")).toThrow("LP-000003 has shipped. Start a new plate.");
  });
});

describe("the invariant", () => {
  const plates = [
    plate("LP-000001", [line("shade", 6), line("bulb", 2)]),
    plate("LP-000002", [line("shade", 4)]),
    plate("LP-000003", [line("shade", 9)], { status: "shipped", locationId: null }),
    plate("LP-000004", [line("shade", 3)], { locationId: other }),
  ];

  it("sums each item on plates per bay, skipping shipped plates", () => {
    expect(platedByKey(plates)).toEqual(
      new Map([
        [`${bay}:shade`, 10],
        [`${bay}:bulb`, 2],
        [`${other}:shade`, 3],
      ]),
    );
    expect(plateUnits(plates[0]!)).toBe(8);
  });

  it("holds when plates claim no more than each bay holds", () => {
    const balances = new Map([
      [`${bay}:shade`, 10],
      [`${bay}:bulb`, 5],
      [`${other}:shade`, 3],
    ]);
    expect(plateOverages(plates, balances)).toEqual([]);
  });

  it("names every bay and item where plates claim more than the bay holds", () => {
    const balances = new Map([
      [`${bay}:shade`, 8],
      [`${bay}:bulb`, 5],
    ]);
    expect(plateOverages(plates, balances)).toEqual([
      { locationId: bay, itemId: "shade", plated: 10, onHand: 8 },
      { locationId: other, itemId: "shade", plated: 3, onHand: 0 },
    ]);
  });

  it("leaves the lots and serials no plate holds", () => {
    const lotted = [plate("LP-000005", [line("bulb", 4, "L1"), line("lamp", 1, null, "S1")])];
    expect(
      looseLots(
        [
          { lotCode: "l1", qty: 5, expiresOn: null },
          { lotCode: "L2", qty: 3, expiresOn: null },
        ],
        lotted,
        bay,
        "bulb",
      ),
    ).toEqual([
      { lotCode: "l1", qty: 1, expiresOn: null },
      { lotCode: "L2", qty: 3, expiresOn: null },
    ]);
    expect(looseLots([{ lotCode: "L1", qty: 5 }], lotted, other, "bulb")).toEqual([{ lotCode: "L1", qty: 5 }]);
    expect(looseSerials(["S1", "s2"], lotted, "lamp")).toEqual(["s2"]);
  });

  it("counts loose lots in date apart from expired ones", () => {
    const lotted = [plate("LP-000005", [line("bulb", 1, "OLD")])];
    const lots = [
      { lotCode: "OLD", qty: 3, expiresOn: 20260920 },
      { lotCode: "NEW", qty: 4, expiresOn: 20261231 },
      { lotCode: "UNDATED", qty: 2, expiresOn: null },
      { lotCode: "EMPTY", qty: 0, expiresOn: 20260101 },
    ];
    expect(lotUnitsByExpiry(looseLots(lots, lotted, bay, "bulb"), 20260930)).toEqual({ live: 6, expired: 2 });
    expect(lotUnitsByExpiry(lots, 20260920)).toEqual({ live: 9, expired: 0 });
  });

  it("splits a bay's balances into plated and loose", () => {
    expect(looseQty(10, 12)).toBe(0);
    expect(
      withPlateShare(
        [
          { itemId: "shade", qty: 20 },
          { itemId: "cord", qty: 5 },
        ],
        plates,
        bay,
      ),
    ).toEqual([
      { itemId: "shade", qty: 20, onPlates: 10, loose: 10 },
      { itemId: "cord", qty: 5, onPlates: 0, loose: 5 },
    ]);
  });
});

describe("loose-first allocation", () => {
  const lots = [
    { lotCode: "L1", qty: 6, expiresOn: null },
    { lotCode: "L2", qty: 4, expiresOn: null },
  ];
  const onL1 = [plate("LP-000001", [line("bulb", 6, "L1")])];

  it("takes loose lots before the lots on plates", () => {
    expect(allocateLooseFirstLots(lots, onL1, bay, "bulb", 3, "LED-BULB")).toEqual([{ lotCode: "L2", qty: 3, expiresOn: null }]);
  });

  it("takes every loose lot before cutting into a plate's lot", () => {
    expect(allocateLooseFirstLots(lots, onL1, bay, "bulb", 5, "LED-BULB")).toEqual([
      { lotCode: "L2", qty: 4, expiresOn: null },
      { lotCode: "L1", qty: 1, expiresOn: null },
    ]);
  });

  it("is plain FIFO without plates, and refuses what the bay cannot cover", () => {
    expect(allocateLooseFirstLots(lots, [], bay, "bulb", 7, "LED-BULB")).toEqual([
      { lotCode: "L1", qty: 6, expiresOn: null },
      { lotCode: "L2", qty: 1, expiresOn: null },
    ]);
    expect(() => allocateLooseFirstLots(lots, onL1, bay, "bulb", 11, "LED-BULB")).toThrow(InsufficientStockError);
  });

  it("takes loose serials first, then serials on plates", () => {
    const onPlate = [plate("LP-000001", [line("lamp", 1, null, "S1"), line("lamp", 1, null, "S2")])];
    expect(allocateLooseFirstSerials(["S1", "S2", "S3"], onPlate, "lamp", 1, "LAMP")).toEqual(["S3"]);
    expect(allocateLooseFirstSerials(["S1", "S2", "S3"], onPlate, "lamp", 2, "LAMP")).toEqual(["S3", "S1"]);
    expect(() => allocateLooseFirstSerials(["S1"], onPlate, "lamp", 2, "LAMP")).toThrow(InsufficientStockError);
  });
});

describe("applyPlateOps", () => {
  it("merges adds of the same item and lot, and gives each serial its own line", () => {
    const [next] = applyPlateOps(
      [plate("LP-000001", [line("shade", 2)])],
      [
        { kind: "add", plateId: "LP-000001", itemId: "shade", qty: 3 },
        { kind: "add", plateId: "LP-000001", itemId: "bulb", qty: 4, lotCode: "l-7" },
        { kind: "add", plateId: "LP-000001", itemId: "lamp", qty: 2, serials: ["s1", "S2"] },
      ],
    );
    expect(next!.lines).toEqual([
      line("shade", 5),
      line("bulb", 4, "L-7"),
      line("lamp", 1, null, "S1"),
      line("lamp", 1, null, "S2"),
    ]);
  });

  it("does not change the plates it was given", () => {
    const before = plate("LP-000001", [line("shade", 2)]);
    applyPlateOps([before], [{ kind: "add", plateId: before.id, itemId: "shade", qty: 3 }]);
    expect(before.lines).toEqual([line("shade", 2)]);
  });

  it("refuses a serial that is already on another plate, or a serial count that does not match", () => {
    const plates = [plate("LP-000001", [line("lamp", 1, null, "S1")]), plate("LP-000002", [])];
    expect(() =>
      applyPlateOps(plates, [{ kind: "add", plateId: "LP-000002", itemId: "lamp", qty: 1, serials: ["S1"] }]),
    ).toThrow("Serial S1 is already on LP-000001.");
    expect(() =>
      applyPlateOps(plates, [{ kind: "add", plateId: "LP-000002", itemId: "lamp", qty: 2, serials: ["S9"] }]),
    ).toThrow(PlateInputError);
  });

  it("takes named serials, then the oldest lines, up to the qty", () => {
    const [next] = applyPlateOps(
      [plate("LP-000001", [line("shade", 2), line("shade", 3, "L1"), line("lamp", 1, null, "S1"), line("lamp", 1, null, "S2")])],
      [
        { kind: "take", plateId: "LP-000001", itemId: "shade", qty: 4 },
        { kind: "take", plateId: "LP-000001", itemId: "lamp", qty: 1, serials: ["S2"] },
      ],
    );
    expect(next!.lines).toEqual([line("shade", 1, "L1"), line("lamp", 1, null, "S1")]);
  });

  it("relocates, empties, closes, and reopens", () => {
    const start = plate("LP-000001", [line("shade", 2)]);
    const [moved] = applyPlateOps([start], [{ kind: "relocate", plateId: start.id, locationId: other }]);
    expect(moved!.locationId).toBe(other);
    const [closed] = applyPlateOps([start], [{ kind: "status", plateId: start.id, status: "closed" }]);
    expect(closed!.status).toBe("closed");
    expect(() => applyPlateOps([closed!], [{ kind: "add", plateId: start.id, itemId: "shade", qty: 1 }])).toThrow(PlateStateError);
    const [broken] = applyPlateOps(
      [closed!],
      [
        { kind: "empty", plateId: start.id },
        { kind: "status", plateId: start.id, status: "open" },
      ],
    );
    expect(broken).toMatchObject({ status: "open", lines: [] });
  });

  it("refuses an op on a plate it was not given", () => {
    expect(() => applyPlateOps([], [{ kind: "empty", plateId: "nope" }])).toThrow(PlateInputError);
  });
});

describe("reconcilePlates", () => {
  it("leaves plates alone while loose stock covers what left the bay", () => {
    const plates = [plate("LP-000001", [line("shade", 6)])];
    expect(reconcilePlates(plates, { balances: new Map([[`${bay}:shade`, 6]]) })).toEqual(plates);
  });

  it("takes a shortfall off open plates before closed ones, newest first", () => {
    const plates = [
      plate("LP-000001", [line("shade", 4)]),
      plate("LP-000002", [line("shade", 4)], { status: "closed" }),
      plate("LP-000003", [line("shade", 4)]),
    ];
    const next = reconcilePlates(plates, { balances: new Map([[`${bay}:shade`, 6]]) });
    expect(next.map((row) => plateUnits(row))).toEqual([2, 4, 0]);
    expect(plateOverages(next, new Map([[`${bay}:shade`, 6]]))).toEqual([]);
  });

  it("empties plates at a bay that holds none any more", () => {
    const next = reconcilePlates([plate("LP-000001", [line("shade", 4), line("bulb", 1)])], {
      balances: new Map([[`${bay}:bulb`, 1]]),
    });
    expect(next[0]!.lines).toEqual([line("bulb", 1)]);
  });

  it("drops serials that left the plate's bay and keeps ones that moved with it", () => {
    const plates = [
      plate("LP-000001", [line("lamp", 1, null, "S1"), line("lamp", 1, null, "S2")]),
      plate("LP-000002", [line("lamp", 1, null, "S3")], { locationId: other }),
    ];
    const next = reconcilePlates(plates, {
      balances: new Map([
        [`${bay}:lamp`, 5],
        [`${other}:lamp`, 1],
      ]),
      serials: new Map([
        ["lamp:S1", null],
        ["lamp:S3", other],
      ]),
    });
    expect(next[0]!.lines).toEqual([line("lamp", 1, null, "S2")]);
    expect(next[1]!.lines).toEqual([line("lamp", 1, null, "S3")]);
  });

  it("shrinks a lot line to what is left of that lot", () => {
    const next = reconcilePlates([plate("LP-000001", [line("bulb", 5, "L1"), line("bulb", 5, "L2")])], {
      balances: new Map([[`${bay}:bulb`, 20]]),
      lots: new Map([
        [`${bay}:bulb:L1`, 2],
        [`${bay}:bulb:L2`, 9],
      ]),
    });
    expect(next[0]!.lines).toEqual([line("bulb", 2, "L1"), line("bulb", 5, "L2")]);
  });
});

describe("settlePlates", () => {
  it("refuses a build past the bay's loose stock", () => {
    const plates = [plate("LP-000001", [line("shade", 16)]), plate("LP-000002", [])];
    const run = () =>
      settlePlates(
        plates,
        [{ kind: "add", plateId: "LP-000002", itemId: "shade", qty: 6 }],
        { balances: new Map([[`${bay}:shade`, 20]]) },
        names,
      );
    expect(run).toThrow(PlateOverLooseError);
    expect(run).toThrow("Only 4 SHADE at A-01-01 are loose, and this needs 6. The rest is already on plates, so add 4 or fewer.");
  });

  it("builds within the loose stock", () => {
    const [, built] = settlePlates(
      [plate("LP-000001", [line("shade", 16)]), plate("LP-000002", [])],
      [{ kind: "add", plateId: "LP-000002", itemId: "shade", qty: 4 }],
      { balances: new Map([[`${bay}:shade`, 20]]) },
    );
    expect(built!.lines).toEqual([line("shade", 4)]);
  });

  it("says when the bay holds none or too little of the item or the lot", () => {
    const empty = plate("LP-000001", []);
    expect(() =>
      settlePlates([empty], [{ kind: "add", plateId: empty.id, itemId: "shade", qty: 1 }], { balances: new Map() }, names),
    ).toThrow("A-01-01 holds no SHADE. Build the plate where the stock is.");
    expect(() =>
      settlePlates(
        [empty],
        [{ kind: "add", plateId: empty.id, itemId: "bulb", qty: 3, lotCode: "L2" }],
        { balances: new Map([[`${bay}:bulb`, 10]]), lots: new Map([[`${bay}:bulb:L2`, 1]]) },
        names,
      ),
    ).toThrow("A-01-01 holds only 1 LED-BULB from lot L2, and this needs 3. Add 1 or fewer.");
  });

  it("lets a receive fill a plate, since the bay gains what the plate gains", () => {
    const [next] = settlePlates(
      [plate("LP-000001", [])],
      [{ kind: "add", plateId: "LP-000001", itemId: "shade", qty: 5 }],
      { balances: new Map([[`${bay}:shade`, 5]]) },
    );
    expect(next!.lines).toEqual([line("shade", 5)]);
  });

  it("moves a plate with its stock and keeps the invariant at both bays", () => {
    const start = [plate("LP-000001", [line("shade", 5)]), plate("LP-000002", [line("shade", 3)])];
    const balances = new Map([
      [`${bay}:shade`, 3],
      [`${other}:shade`, 7],
    ]);
    const next = settlePlates(start, [{ kind: "relocate", plateId: "LP-000001", locationId: other }], { balances });
    expect(next[0]).toMatchObject({ locationId: other, lines: [line("shade", 5)] });
    expect(next[1]).toMatchObject({ locationId: bay, lines: [line("shade", 3)] });
    expect(plateOverages(next, balances)).toEqual([]);
  });

  it("refuses to relocate a plate whose stock did not move with it", () => {
    expect(() =>
      settlePlates(
        [plate("LP-000001", [line("shade", 5)])],
        [{ kind: "relocate", plateId: "LP-000001", locationId: other }],
        { balances: new Map([[`${bay}:shade`, 5]]) },
      ),
    ).toThrow(PlateOverLooseError);
  });

  it("ships a closed plate that a pick emptied, but keeps an emptied open tote", () => {
    const start = [
      plate("LP-000001", [line("shade", 2)], { status: "closed" }),
      plate("LP-000002", [line("shade", 1)]),
    ];
    const ledger = { balances: new Map([[`${bay}:shade`, 0]]), pickedFrom: new Set([bay]) };
    const next = settlePlates(
      start,
      [
        { kind: "take", plateId: "LP-000001", itemId: "shade", qty: 2 },
        { kind: "take", plateId: "LP-000002", itemId: "shade", qty: 1 },
      ],
      ledger,
    );
    expect(next[0]).toMatchObject({ status: "shipped", locationId: null, lines: [] });
    expect(next[1]).toMatchObject({ status: "open", locationId: bay, lines: [] });
  });

  it("keeps a closed plate a count emptied, since nothing was picked", () => {
    const [next] = settlePlates([plate("LP-000001", [line("shade", 2)], { status: "closed" })], [], {
      balances: new Map(),
    });
    expect(next).toMatchObject({ status: "closed", locationId: bay, lines: [] });
  });
});

describe("overLooseText", () => {
  it("blames plates only when plates hold the rest", () => {
    expect(overLooseText("SHADE", "A-01-01", 20, 4, 6)).toBe(
      "Only 4 SHADE at A-01-01 are loose, and this needs 6. The rest is already on plates, so add 4 or fewer.",
    );
    expect(overLooseText("SHADE", "A-01-01", 20, 0, 1)).toBe("No SHADE at A-01-01 is loose. All of it is already on plates.");
    expect(overLooseText("SHADE", "A-01-01", 2, 2, 5)).toBe("A-01-01 holds only 2 SHADE, and this needs 5. Add 2 or fewer.");
  });

  it("points expired loose stock at its lot", () => {
    expect(overLooseText("GLUE", "A-01-03", 2, 0, 1, null, 2)).toBe(
      "All the loose GLUE at A-01-03 is in expired lots. Type the lot to put it on the plate anyway.",
    );
    expect(overLooseText("GLUE", "A-01-03", 9, 3, 5, null, 2)).toBe(
      "Only 3 loose GLUE at A-01-03 are in date, and this needs 5. Add 3 or fewer, or type the lot to add expired stock.",
    );
  });
});

describe("receiveOntoPlate", () => {
  it("adds each received line, and brings an empty plate to the receiving bay", () => {
    const tote = plate("LP-000010", [], { locationId: other });
    expect(
      receiveOntoPlate(tote, bay, [
        { itemId: "bulb", qty: 4, lotCode: "L9" },
        { itemId: "lamp", qty: 1, serials: ["S8"] },
        { itemId: "shade", qty: 0 },
      ]),
    ).toEqual([
      { kind: "relocate", plateId: "LP-000010", locationId: bay },
      { kind: "add", plateId: "LP-000010", itemId: "bulb", qty: 4, lotCode: "L9", serials: null },
      { kind: "add", plateId: "LP-000010", itemId: "lamp", qty: 1, lotCode: null, serials: ["S8"] },
    ]);
    expect(receiveOntoPlate({ ...tote, locationId: bay }, bay, [{ itemId: "shade", qty: 2 }])).toHaveLength(1);
  });
});

describe("plateMoveLines", () => {
  it("moves each item and lot once, with its serials together", () => {
    expect(
      plateMoveLines([
        line("shade", 5),
        line("bulb", 2, "L1"),
        line("bulb", 3, "L2"),
        line("lamp", 1, null, "S1"),
        line("lamp", 1, null, "S2"),
      ]),
    ).toEqual([
      { itemId: "shade", lotCode: null, qty: 5, serials: null },
      { itemId: "bulb", lotCode: "L1", qty: 2, serials: null },
      { itemId: "bulb", lotCode: "L2", qty: 3, serials: null },
      { itemId: "lamp", lotCode: null, qty: 2, serials: ["S1", "S2"] },
    ]);
  });
});

describe("drawFromPlate", () => {
  const tote = plate("LP-000009", [
    line("bulb", 3, "L1"),
    line("bulb", 4, "L2"),
    line("lamp", 1, null, "S1"),
    line("lamp", 1, null, "S2"),
    line("shade", 5),
  ]);

  it("takes the oldest lines first, one piece per lot", () => {
    expect(drawFromPlate(tote, [{ itemId: "bulb", sku: "LED-BULB", qty: 5 }])).toEqual([
      { want: 0, qty: 3, lotCode: "L1", serials: null },
      { want: 0, qty: 2, lotCode: "L2", serials: null },
    ]);
  });

  it("takes the lot or serials a pick names", () => {
    expect(
      drawFromPlate(tote, [
        { itemId: "bulb", sku: "LED-BULB", qty: 2, lotCode: "l2" },
        { itemId: "lamp", sku: "LAMP", qty: 1, serials: ["S2"] },
      ]),
    ).toEqual([
      { want: 0, qty: 2, lotCode: "L2", serials: null },
      { want: 1, qty: 1, lotCode: null, serials: ["S2"] },
    ]);
  });

  it("carries the plate's serials when the pick names none", () => {
    expect(drawFromPlate(tote, [{ itemId: "lamp", sku: "LAMP", qty: 2 }])).toEqual([
      { want: 0, qty: 2, lotCode: null, serials: ["S1", "S2"] },
    ]);
  });

  it("does not hand the same units to two wants", () => {
    expect(() =>
      drawFromPlate(tote, [
        { itemId: "shade", sku: "SHADE", qty: 4 },
        { itemId: "shade", sku: "SHADE", qty: 2 },
      ]),
    ).toThrow(PlateShortError);
  });

  it("refuses more than the plate holds", () => {
    expect(() => drawFromPlate(tote, [{ itemId: "shade", sku: "SHADE", qty: 6 }])).toThrow(
      "LP-000009 holds 5 SHADE, and this needs 6. Pick 5 from it, then scan the bay for the rest.",
    );
    expect(() => drawFromPlate(tote, [{ itemId: "cord", sku: "CORD", qty: 1 }])).toThrow(
      "LP-000009 holds no CORD. Scan the bay to pick it loose.",
    );
    expect(() => drawFromPlate(tote, [{ itemId: "lamp", sku: "LAMP", qty: 1, serials: ["S7"] }])).toThrow(
      "Serial S7 of LAMP is not on LP-000009. Scan the bay to pick it loose.",
    );
  });

  it("refuses a shipped plate", () => {
    expect(() => drawFromPlate({ ...tote, status: "shipped", locationId: null }, [{ itemId: "shade", sku: "SHADE", qty: 1 }])).toThrow(
      PlateStateError,
    );
  });
});
