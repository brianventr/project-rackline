import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { ITEM_TYPES, LOCATION_TYPES, SLOT_ROLES } from "../lib/org";
import { parseTeamInvite } from "./auth-mail";
import { HOLD_REASONS } from "./holds";
import {
  FORM_ITEM_TYPES,
  FORM_LOCATION_TYPES,
  FORM_SLOT_ROLES,
  asnFormSchema,
  blankLine,
  buildFormSchema,
  clientFormSchema,
  emailSchema,
  holdFormSchema,
  inviteFormSchema,
  itemFormSchema,
  kitFormSchema,
  lineSchema,
  linesSchema,
  locationFormSchema,
  orderFormSchema,
  parseQty,
  purchaseFormSchema,
  qtySchema,
  receiptFormSchema,
  returnFormSchema,
  skuSchema,
  uniqueLinesSchema,
  wholeNumber,
  workOrderFormSchema,
  yardVisitFormSchema,
  zoneFormSchema,
} from "./form-schemas";

/** `{ "lines.0.qty": "Qty must be 1 or more." }`: the first message per path, the way the form shows it. */
function errorsOf(schema: z.ZodType, value: unknown): Record<string, string> {
  const result = schema.safeParse(value);
  if (result.success) return {};
  const out: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join(".");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

function ok<S extends z.ZodType>(schema: S, value: z.input<S>): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`expected ok, got ${JSON.stringify(result.error.issues)}`);
  return result.data;
}

describe("server lists stay in step", () => {
  it("item types, location types, and slot roles match src/lib/org.ts", () => {
    expect([...FORM_ITEM_TYPES]).toEqual([...ITEM_TYPES]);
    expect([...FORM_LOCATION_TYPES]).toEqual([...LOCATION_TYPES]);
    expect([...FORM_SLOT_ROLES]).toEqual([...SLOT_ROLES]);
  });
});

describe("qtySchema", () => {
  it("coerces whole numbers from strings and numbers", () => {
    expect(ok(qtySchema, "1")).toBe(1);
    expect(ok(qtySchema, " 12 ")).toBe(12);
    expect(ok(qtySchema, "2.0")).toBe(2);
    expect(ok(qtySchema, 5)).toBe(5);
  });

  it("rejects blank, fractions, text, zero, and negatives in product voice", () => {
    expect(errorsOf(qtySchema, "")).toEqual({ "": "Enter a qty." });
    expect(errorsOf(qtySchema, "   ")).toEqual({ "": "Enter a qty." });
    expect(errorsOf(qtySchema, "1.5")).toEqual({ "": "Qty must be a whole number." });
    expect(errorsOf(qtySchema, "abc")).toEqual({ "": "Qty must be a whole number." });
    expect(errorsOf(qtySchema, "0")).toEqual({ "": "Qty must be 1 or more." });
    expect(errorsOf(qtySchema, "-3")).toEqual({ "": "Qty must be 1 or more." });
    expect(errorsOf(qtySchema, 0)).toEqual({ "": "Qty must be 1 or more." });
  });

  it("parseQty returns the number or null", () => {
    expect(parseQty("4")).toBe(4);
    expect(parseQty("0")).toBeNull();
    expect(parseQty(undefined)).toBeNull();
  });
});

describe("wholeNumber", () => {
  const schema = wholeNumber(0, { blankAs: 0, notWhole: "Whole.", tooSmall: "Small." });
  it("uses blankAs for a blank field", () => {
    expect(ok(schema, "")).toBe(0);
    expect(ok(schema, "7")).toBe(7);
  });
  it("falls back to the whole-number copy when neither empty nor blankAs is set", () => {
    const bare = wholeNumber(1, { notWhole: "Whole.", tooSmall: "Small." });
    expect(errorsOf(bare, "")).toEqual({ "": "Whole." });
  });
});

describe("skuSchema", () => {
  it("accepts any non-blank SKU and keeps it as typed", () => {
    expect(ok(skuSchema, "lamp-01")).toBe("lamp-01");
    expect(ok(skuSchema, " LAMP ")).toBe(" LAMP ");
  });
  it("rejects blank", () => {
    expect(errorsOf(skuSchema, "")).toEqual({ "": "Enter a SKU." });
    expect(errorsOf(skuSchema, "  ")).toEqual({ "": "Enter a SKU." });
  });
});

describe("emailSchema", () => {
  it("accepts what the server accepts", () => {
    expect(ok(emailSchema, "sam@example.com")).toBe("sam@example.com");
    expect(ok(emailSchema, " Sam@Example.co.uk ")).toBe(" Sam@Example.co.uk ");
  });
  it("asks for an email, then a full one", () => {
    expect(errorsOf(emailSchema, "")).toEqual({ "": "Enter an email." });
    expect(errorsOf(emailSchema, "sam")).toEqual({ "": "Enter a full email, like sam@example.com." });
    expect(errorsOf(emailSchema, "sam@example")).toEqual({ "": "Enter a full email, like sam@example.com." });
    expect(errorsOf(emailSchema, "sam @example.com")).toEqual({ "": "Enter a full email, like sam@example.com." });
  });
});

describe("lineSchema", () => {
  it("needs a SKU and a qty of 1 or more", () => {
    expect(ok(lineSchema, { itemId: "i1", qty: "3" })).toEqual({ itemId: "i1", qty: 3 });
    expect(errorsOf(lineSchema, { itemId: "", qty: "0" })).toEqual({
      itemId: "Pick a SKU.",
      qty: "Qty must be 1 or more.",
    });
  });
});

describe("linesSchema", () => {
  it("drops rows without a SKU and coerces qty, like the old sheets", () => {
    expect(
      ok(linesSchema, [
        { itemId: "i1", qty: "2" },
        { itemId: "", qty: "1" },
        { itemId: "i2", qty: "5" },
      ]),
    ).toEqual([
      { itemId: "i1", qty: 2 },
      { itemId: "i2", qty: 5 },
    ]);
  });

  it("ignores a bad qty on a blank row that will be dropped", () => {
    expect(ok(linesSchema, [{ itemId: "i1", qty: "1" }, { itemId: "", qty: "" }])).toEqual([{ itemId: "i1", qty: 1 }]);
  });

  it("allows the same SKU twice (orders)", () => {
    expect(ok(linesSchema, [{ itemId: "i1", qty: "1" }, { itemId: "i1", qty: "2" }])).toHaveLength(2);
  });

  it("asks for a SKU on the first row when no row has one", () => {
    expect(errorsOf(linesSchema, [blankLine()])).toEqual({ "0.itemId": "Pick a SKU." });
    expect(errorsOf(linesSchema, [blankLine(), blankLine()])).toEqual({ "0.itemId": "Pick a SKU." });
    expect(errorsOf(linesSchema, [])).toEqual({ "": "Add a line." });
  });

  it("puts qty errors on the row that has them", () => {
    expect(
      errorsOf(linesSchema, [
        { itemId: "i1", qty: "1" },
        { itemId: "i2", qty: "0" },
        { itemId: "i3", qty: "1.5" },
      ]),
    ).toEqual({ "1.qty": "Qty must be 1 or more.", "2.qty": "Qty must be a whole number." });
  });
});

describe("uniqueLinesSchema", () => {
  it("flags a repeated SKU on the later row", () => {
    expect(
      errorsOf(uniqueLinesSchema, [
        { itemId: "i1", qty: "1" },
        { itemId: "i2", qty: "1" },
        { itemId: "i1", qty: "4" },
      ]),
    ).toEqual({ "2.itemId": "This SKU is already on line 1." });
  });
  it("accepts distinct SKUs", () => {
    expect(ok(uniqueLinesSchema, [{ itemId: "i1", qty: "1" }, { itemId: "i2", qty: 3 }])).toEqual([
      { itemId: "i1", qty: 1 },
      { itemId: "i2", qty: 3 },
    ]);
  });
});

describe("itemFormSchema", () => {
  const base = {
    sku: "LAMP",
    name: "Desk lamp",
    type: "finished" as const,
    barcode: "",
    reorderPoint: "0",
    baselineShipRate: "",
    pickMin: "0",
    trackLot: false,
    trackSerial: false,
    catchWeight: false,
    trackExpiry: false,
  };

  it("accepts a new SKU and coerces the numbers the way the sheet sends them", () => {
    const value = ok(itemFormSchema, { ...base, reorderPoint: "", pickMin: "4", baselineShipRate: "1.5" });
    expect(value.reorderPoint).toBe(0);
    expect(value.pickMin).toBe(4);
    expect(value.baselineShipRate).toBe(1.5);
    expect(ok(itemFormSchema, base).baselineShipRate).toBeNull();
  });

  it("rejects what POST /api/items rejects", () => {
    expect(
      errorsOf(itemFormSchema, {
        ...base,
        sku: " ",
        name: "",
        type: "gadget",
        reorderPoint: "-1",
        pickMin: "2.5",
        baselineShipRate: "-2",
      }),
    ).toEqual({
      sku: "Enter a SKU.",
      name: "Enter a name.",
      type: "Pick a type.",
      reorderPoint: "Reorder point cannot be below 0.",
      pickMin: "Pick min must be a whole number.",
      baselineShipRate: "Baseline cannot be below 0.",
    });
    expect(errorsOf(itemFormSchema, { ...base, reorderPoint: "x", baselineShipRate: "fast" })).toEqual({
      reorderPoint: "Reorder point must be a whole number.",
      baselineShipRate: "Baseline must be a number.",
    });
  });
});

describe("locationFormSchema", () => {
  const base = { code: "A-01-04", name: "Aisle A bay 4", type: "storage" as const, slotRole: "pick" as const, aisle: "A", rack: "01", bay: "04", level: "1" };

  it("accepts a bay and treats a blank level as 1", () => {
    expect(ok(locationFormSchema, base).level).toBe(1);
    expect(ok(locationFormSchema, { ...base, level: "" }).level).toBe(1);
    expect(ok(locationFormSchema, { ...base, type: "receiving", slotRole: "none", aisle: "", rack: "", bay: "" }).type).toBe(
      "receiving",
    );
  });

  it("rejects blank code/name, unknown type or role, and a bad level", () => {
    expect(
      errorsOf(locationFormSchema, { ...base, code: "", name: " ", type: "yard", slotRole: "top", level: "0" }),
    ).toEqual({
      code: "Enter a code.",
      name: "Enter a name.",
      type: "Pick a type.",
      slotRole: "Pick a slot role.",
      level: "Level must be 1 or more.",
    });
    expect(errorsOf(locationFormSchema, { ...base, level: "1.5" })).toEqual({ level: "Level must be a whole number." });
  });
});

describe("orderFormSchema", () => {
  it("accepts a floor order and keeps the customer text as typed", () => {
    const value = ok(orderFormSchema, {
      customerName: " Acme ",
      shipToAddress: "",
      lines: [{ itemId: "i1", qty: "2" }, blankLine()],
    });
    expect(value).toEqual({ customerName: " Acme ", shipToAddress: "", lines: [{ itemId: "i1", qty: 2 }] });
  });

  it("shows every problem at once when submitted empty", () => {
    expect(errorsOf(orderFormSchema, { customerName: "", shipToAddress: "", lines: [blankLine()] })).toEqual({
      customerName: "Enter a customer name.",
      "lines.0.itemId": "Pick a SKU.",
    });
  });
});

describe("receiptFormSchema", () => {
  it("needs a line, notes are optional, SKUs are unique", () => {
    expect(ok(receiptFormSchema, { notes: "", lines: [{ itemId: "i1", qty: "10" }] }).lines).toEqual([
      { itemId: "i1", qty: 10 },
    ]);
    expect(errorsOf(receiptFormSchema, { notes: "", lines: [blankLine()] })).toEqual({ "lines.0.itemId": "Pick a SKU." });
    expect(
      errorsOf(receiptFormSchema, { notes: "", lines: [{ itemId: "i1", qty: "1" }, { itemId: "i1", qty: "1" }] }),
    ).toEqual({ "lines.1.itemId": "This SKU is already on line 1." });
  });
});

describe("purchaseFormSchema", () => {
  it("needs a vendor and lines", () => {
    expect(ok(purchaseFormSchema, { vendorName: "Brightline", notes: "", lines: [{ itemId: "i1", qty: "5" }] }).vendorName).toBe(
      "Brightline",
    );
    expect(errorsOf(purchaseFormSchema, { vendorName: "", notes: "", lines: [{ itemId: "i1", qty: "0" }] })).toEqual({
      vendorName: "Enter a vendor.",
      "lines.0.qty": "Qty must be 1 or more.",
    });
  });
});

describe("inviteFormSchema", () => {
  const base = { name: "Sam Ortiz", email: "sam@example.com", role: "operator" as const, password: "" };

  it("accepts an invite without a password, or with 8+ characters", () => {
    expect(ok(inviteFormSchema, base).role).toBe("operator");
    expect(ok(inviteFormSchema, { ...base, role: "owner", password: "longenough" }).password).toBe("longenough");
  });

  it("rejects what parseTeamInvite rejects", () => {
    expect(errorsOf(inviteFormSchema, { name: "", email: "sam", role: "admin", password: "short" })).toEqual({
      name: "Enter their name.",
      email: "Enter a full email, like sam@example.com.",
      role: "Pick owner or operator.",
      password: "Password must be at least 8 characters.",
    });
    // The server trims before counting, so seven letters padded with spaces are still too short.
    expect(errorsOf(inviteFormSchema, { ...base, password: " 1234567 " })).toEqual({
      password: "Password must be at least 8 characters.",
    });
  });

  it("agrees with the server parser on the same inputs", () => {
    const cases = [
      base,
      { ...base, email: "nope" },
      { ...base, name: " " },
      { ...base, password: "1234567" },
      { ...base, password: "12345678" },
    ];
    for (const input of cases) {
      let serverOk = true;
      try {
        parseTeamInvite(input);
      } catch {
        serverOk = false;
      }
      expect(inviteFormSchema.safeParse(input).success, JSON.stringify(input)).toBe(serverOk);
    }
  });
});

describe("clientFormSchema and zoneFormSchema", () => {
  it("need a code and a name", () => {
    expect(ok(clientFormSchema, { code: "acme", name: "Acme Co" }).code).toBe("acme");
    expect(errorsOf(clientFormSchema, { code: "", name: "" })).toEqual({
      code: "Enter a client code.",
      name: "Enter a client name.",
    });
    expect(ok(zoneFormSchema, { code: "Z1", name: "Fast movers" }).name).toBe("Fast movers");
    expect(errorsOf(zoneFormSchema, { code: " ", name: "" })).toEqual({
      code: "Enter a zone code.",
      name: "Enter a zone name.",
    });
  });
});

describe("returnFormSchema and asnFormSchema", () => {
  it("mirror the RMA and ASN routes", () => {
    expect(ok(returnFormSchema, { customerName: "Acme", orderId: "", notes: "", lines: [{ itemId: "i1", qty: "1" }] }).lines).toHaveLength(1);
    expect(errorsOf(returnFormSchema, { customerName: "", orderId: "", notes: "", lines: [blankLine()] })).toEqual({
      customerName: "Enter a customer name.",
      "lines.0.itemId": "Pick a SKU.",
    });
    expect(errorsOf(asnFormSchema, { vendorName: "", notes: "", lines: [{ itemId: "i1", qty: "1" }, { itemId: "i1", qty: "1" }] })).toEqual({
      vendorName: "Enter a vendor.",
      "lines.1.itemId": "This SKU is already on line 1.",
    });
  });
});

describe("holdFormSchema", () => {
  const base = { locationId: "loc1", itemId: "", lotCode: "", reason: "QC" as const, notes: "" };
  it("accepts a bay hold and every server reason", () => {
    for (const reason of HOLD_REASONS) expect(ok(holdFormSchema, { ...base, reason }).reason).toBe(reason);
  });
  it("needs a bay, a known reason, and a SKU for a lot hold", () => {
    expect(errorsOf(holdFormSchema, { ...base, locationId: "", reason: "Lost" })).toEqual({
      locationId: "Pick a bay.",
      reason: "Pick a reason.",
    });
    expect(errorsOf(holdFormSchema, { ...base, lotCode: "L-42" })).toEqual({ itemId: "Pick the SKU this lot belongs to." });
    expect(ok(holdFormSchema, { ...base, itemId: "i1", lotCode: "L-42" }).lotCode).toBe("L-42");
  });
});

describe("buildFormSchema (work orders and kits)", () => {
  it("is shared by both routes", () => {
    expect(workOrderFormSchema).toBe(buildFormSchema);
    expect(kitFormSchema).toBe(buildFormSchema);
  });
  it("needs an item, a qty, and both bays", () => {
    expect(ok(buildFormSchema, { itemId: "i1", qty: "3", sourceLocationId: "a", outputLocationId: "b" }).qty).toBe(3);
    expect(errorsOf(buildFormSchema, { itemId: "", qty: "0", sourceLocationId: "", outputLocationId: "" })).toEqual({
      itemId: "Pick what to build.",
      qty: "Qty must be 1 or more.",
      sourceLocationId: "Pick the bay to consume from.",
      outputLocationId: "Pick where finished units go.",
    });
  });
});

describe("yardVisitFormSchema", () => {
  it("needs a carrier", () => {
    expect(ok(yardVisitFormSchema, { carrierName: "Old Dominion", trailerNumber: "", notes: "" }).carrierName).toBe("Old Dominion");
    expect(errorsOf(yardVisitFormSchema, { carrierName: "", trailerNumber: "53", notes: "" })).toEqual({
      carrierName: "Enter the carrier.",
    });
  });
});

describe("New order payload parity", () => {
  type RawOrder = { customerName: string; shipToAddress: string; lines: { itemId: string; qty: string }[] };
  /** How the sheet built its body before inline validation (raw strings straight from state). */
  function legacyBody(warehouseId: string, raw: RawOrder): string {
    return JSON.stringify({
      warehouseId,
      customerName: raw.customerName,
      shipToAddress: raw.shipToAddress || undefined,
      lines: raw.lines.filter((line) => line.itemId).map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
    });
  }
  /** How the converted sheet in OrdersPage builds it from the schema output. */
  function convertedBody(warehouseId: string, raw: RawOrder): string {
    const values = ok(orderFormSchema, raw);
    return JSON.stringify({
      warehouseId,
      customerName: values.customerName,
      shipToAddress: values.shipToAddress || undefined,
      lines: values.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
    });
  }

  it("sends byte-for-byte the same body for every order the schema accepts", () => {
    const cases: RawOrder[] = [
      { customerName: "Acme", shipToAddress: "", lines: [{ itemId: "i1", qty: "1" }] },
      { customerName: " Acme retail ", shipToAddress: "14 Dock Street\nPortland, OR 97201", lines: [{ itemId: "i1", qty: "12" }] },
      { customerName: "Harbor", shipToAddress: "", lines: [blankLine(), { itemId: "i2", qty: " 3 " }, { itemId: "i2", qty: "2.0" }] },
      { customerName: "Deep Ellum", shipToAddress: "  ", lines: [{ itemId: "i3", qty: "1e1" }, { itemId: "", qty: "" }] },
    ];
    for (const raw of cases) expect(convertedBody("wh1", raw)).toBe(legacyBody("wh1", raw));
  });
});
