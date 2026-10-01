import { describe, expect, it } from "vitest";
import { CarrierLiveError } from "./carrier-live";
import {
  CustomsRequiredError,
  customsBlocker,
  customsForLabel,
  customsFormKind,
  customsGaps,
  customsRequiredMessage,
  customsWeights,
  declaredCustoms,
  exportFilingFor,
  labelCountries,
  normalizeHsCode,
  parseCustomsPatch,
  quoteCustoms,
  type CustomsLine,
} from "./customs";

const lamp: CustomsLine = {
  itemId: "i-lamp",
  sku: "LAMP",
  itemName: "Desk lamp",
  qty: 2,
  shipWeightOz: 24,
  hsCode: "9405.20",
  originCountry: "US",
  customsDescription: null,
  customsValueCents: 4500,
};
const shade: CustomsLine = {
  itemId: "i-shade",
  sku: "SHADE",
  itemName: "Linen shade",
  qty: 1,
  shipWeightOz: null,
  hsCode: "940599",
  originCountry: "Portugal",
  customsDescription: "Lamp shade, linen",
  customsValueCents: 1800,
};
const portland = { text: "14 Dock St, Portland, OR 97209", country: "US" };
const toronto = { text: "22 King St W, Toronto, ON M5H 1A1" };
const berlin = { text: "Hauptstr 5\n10115 Berlin\nGermany" };

function label(lines: CustomsLine[], toCountry = "CA", parcelWeightOz = 64) {
  return customsForLabel({ fromCountry: "US", toCountry, lines, parcelWeightOz, signer: "Northwind Makers", invoiceNumber: "#1004" });
}

describe("customs codes", () => {
  it("keeps 6 to 10 digit HS codes and drops the dots people type", () => {
    expect(normalizeHsCode("9405.20")).toBe("940520");
    expect(normalizeHsCode(" 9405 20 10 ")).toBe("94052010");
    expect(normalizeHsCode("6109.10.0012")).toBe("6109100012");
    expect(normalizeHsCode("94-05")).toBeNull();
    expect(normalizeHsCode("lamp")).toBeNull();
    expect(normalizeHsCode(null)).toBeNull();
  });

  it("picks the postal form by value", () => {
    expect(customsFormKind(40_000)).toBe("CN22");
    expect(customsFormKind(40_001)).toBe("CN23");
  });
});

describe("customsGaps", () => {
  it("names each SKU once with what it lacks, skipping zero lines", () => {
    const gaps = customsGaps([
      { ...lamp, hsCode: null, customsValueCents: null },
      { ...lamp, hsCode: null },
      { ...shade, originCountry: "Atlantis" },
      { ...shade, sku: "CORD", qty: 0, hsCode: null },
    ]);
    expect(gaps).toEqual([
      { sku: "LAMP", itemId: "i-lamp", missing: ["hsCode", "customsValueCents"] },
      { sku: "SHADE", itemId: "i-shade", missing: ["originCountry"] },
    ]);
  });

  it("writes a plain message naming the SKU and the field", () => {
    expect(customsRequiredMessage([{ sku: "LAMP", itemId: null, missing: ["hsCode"] }])).toBe(
      "LAMP needs an HS code to ship abroad. Add it under Customs on the item.",
    );
    expect(customsRequiredMessage([{ sku: "LAMP", itemId: null, missing: ["hsCode", "originCountry", "customsValueCents"] }])).toBe(
      "LAMP needs an HS code, a country of origin, and a declared value to ship abroad. Add them under Customs on the item.",
    );
    expect(
      customsRequiredMessage([
        { sku: "LAMP", itemId: null, missing: ["customsValueCents"] },
        { sku: "SHADE", itemId: null, missing: ["hsCode"] },
        { sku: "CORD", itemId: null, missing: ["hsCode"] },
      ]),
    ).toBe("LAMP needs a declared value to ship abroad, and 2 more SKUs need customs details too. Add them under Customs on each item.");
  });
});

describe("customsWeights", () => {
  it("uses known ship weights and shares the rest by quantity", () => {
    expect(customsWeights([lamp, shade], 64)).toEqual([48, 16]);
    expect(customsWeights([{ qty: 3 }, { qty: 1 }], 40)).toEqual([30, 10]);
  });

  it("shrinks known weights to fit the parcel and never declares zero", () => {
    expect(customsWeights([lamp, shade], 24)).toEqual([24, 1]);
    expect(customsWeights([{ qty: 1, shipWeightOz: 10 }], 5)).toEqual([5]);
  });
});

describe("exportFilingFor", () => {
  const items = (cents: number[]) =>
    cents.map((valueCents, index) => ({
      sku: `S${index}`,
      description: "x",
      qty: 1,
      unitValueCents: valueCents,
      valueCents,
      weightOz: 1,
      hsCode: index < 2 ? "940520" : "940599",
      originCountry: "US",
    }));

  it("files nothing for exports from outside the US", () => {
    expect(exportFilingFor("CA", "US", items([500_000]))).toBeNull();
  });

  it("uses the Canada exemption and the low-value exemption per tariff code", () => {
    expect(exportFilingFor("US", "CA", items([900_000]))).toBe("NOEEI 30.36");
    expect(exportFilingFor("US", "DE", items([125_000, 125_000, 200_000]))).toBe("NOEEI 30.37(a)");
    expect(exportFilingFor("US", "DE", items([125_000, 125_001]))).toBe("ITN");
  });
});

describe("customsForLabel", () => {
  it("is null for a domestic label or an unknown country", () => {
    expect(label([lamp], "US")).toBeNull();
    expect(customsForLabel({ fromCountry: "US", toCountry: null, lines: [lamp], parcelWeightOz: 16, signer: "", invoiceNumber: "1" })).toBeNull();
  });

  it("declares each line with totals, codes, and the exemption", () => {
    const customs = label([lamp, shade]);
    expect(customs).toEqual({
      contents: "merchandise",
      signer: "Northwind Makers",
      invoiceNumber: "#1004",
      currency: "USD",
      fromCountry: "US",
      toCountry: "CA",
      items: [
        {
          sku: "LAMP",
          description: "Desk lamp",
          qty: 2,
          unitValueCents: 4500,
          valueCents: 9000,
          weightOz: 48,
          hsCode: "940520",
          originCountry: "US",
        },
        {
          sku: "SHADE",
          description: "Lamp shade, linen",
          qty: 1,
          unitValueCents: 1800,
          valueCents: 1800,
          weightOz: 16,
          hsCode: "940599",
          originCountry: "PT",
        },
      ],
      valueCents: 10_800,
      exportFiling: "NOEEI 30.36",
    });
  });

  it("refuses with CUSTOMS_REQUIRED naming the SKU", () => {
    const run = () => label([lamp, { ...shade, hsCode: "" }]);
    expect(run).toThrow(CustomsRequiredError);
    try {
      run();
    } catch (err) {
      expect(err).toMatchObject({ code: "CUSTOMS_REQUIRED", sku: "SHADE" });
      expect((err as Error).message).toBe("SHADE needs an HS code to ship abroad. Add it under Customs on the item.");
    }
  });

  it("refuses an export that needs an ITN", () => {
    const pricey = { ...lamp, qty: 1, customsValueCents: 300_000 };
    expect(() => label([pricey], "DE")).toThrow(CarrierLiveError);
    expect(() => label([pricey], "DE")).toThrow(/ITN/);
    expect(label([pricey], "CA")?.exportFiling).toBe("NOEEI 30.36");
  });

  it("quotes without throwing while details are missing", () => {
    expect(quoteCustoms({ fromCountry: "US", toCountry: "CA", lines: [{ ...lamp, hsCode: null }], parcelWeightOz: 16, signer: "", invoiceNumber: "1" })).toBeNull();
    expect(quoteCustoms({ fromCountry: "US", toCountry: "CA", lines: [lamp], parcelWeightOz: 48, signer: "", invoiceNumber: "1" })?.signer).toBe(
      "Shipper",
    );
  });
});

describe("labelCountries and customsBlocker", () => {
  it("reads both countries from the label addresses", () => {
    expect(labelCountries({ shipFrom: portland, shipTo: toronto })).toEqual({ from: "US", to: "CA" });
    expect(labelCountries({ shipFrom: portland, shipTo: berlin })).toEqual({ from: "US", to: "DE" });
    expect(labelCountries({ shipFrom: portland, shipTo: { text: "9 Bay Ave, Austin, TX 78701" } })).toEqual({ from: "US", to: "US" });
    expect(labelCountries({ shipFrom: portland, shipTo: { text: "Somewhere", country: "Japan" } }).to).toBe("JP");
  });

  it("blocks only an international order with gaps, pointing at the item", () => {
    expect(customsBlocker({ shipFrom: portland, shipTo: { text: "9 Bay Ave, Austin, TX 78701" }, lines: [{ ...lamp, hsCode: null }] })).toBeNull();
    expect(customsBlocker({ shipFrom: portland, shipTo: toronto, lines: [lamp, shade] })).toBeNull();
    expect(customsBlocker({ shipFrom: portland, shipTo: toronto, lines: [lamp, { ...shade, customsValueCents: 0 }] })).toEqual({
      code: "CUSTOMS_REQUIRED",
      error: "SHADE needs a declared value to ship abroad. Add it under Customs on the item.",
      sku: "SHADE",
      itemId: "i-shade",
    });
  });
});

describe("declaredCustoms", () => {
  const sent = label([lamp])!;
  const event = (trackingNumber: string, customs: unknown) => ({
    requestJson: JSON.stringify({ carrierService: "usps_priority", ...(customs ? { customs } : {}) }),
    responseJson: JSON.stringify({ trackingNumber }),
  });

  it("reads the declaration sent with the label on file", () => {
    expect(declaredCustoms([event("NEW", sent), event("OLD", { ...sent, valueCents: 1 })], "NEW")).toEqual(sent);
    expect(declaredCustoms([event("NEW", sent), event("OLD", { ...sent, valueCents: 1 })], "OLD")?.valueCents).toBe(1);
  });

  it("is null for another label, no customs, bad JSON, or no tracking", () => {
    expect(declaredCustoms([event("OTHER", sent)], "NEW")).toBeNull();
    expect(declaredCustoms([event("NEW", null)], "NEW")).toBeNull();
    expect(declaredCustoms([{ requestJson: "{", responseJson: "nope" }], "NEW")).toBeNull();
    expect(declaredCustoms([event("NEW", { items: "x" })], "NEW")).toBeNull();
    expect(declaredCustoms([event("NEW", sent)], null)).toBeNull();
  });
});

describe("parseCustomsPatch", () => {
  it("normalizes what people type and clears blanks", () => {
    expect(
      parseCustomsPatch({ hsCode: "9405.20", originCountry: "china", customsDescription: "  Desk lamp ", customsValueCents: 4500 }),
    ).toEqual({ ok: true, patch: { hsCode: "940520", originCountry: "CN", customsDescription: "Desk lamp", customsValueCents: 4500 } });
    expect(parseCustomsPatch({ hsCode: "", originCountry: " ", customsDescription: "", customsValueCents: null })).toEqual({
      ok: true,
      patch: { hsCode: null, originCountry: null, customsDescription: null, customsValueCents: null },
    });
    expect(parseCustomsPatch({ customsValueCents: "1250" })).toEqual({ ok: true, patch: { customsValueCents: 1250 } });
    expect(parseCustomsPatch({})).toEqual({ ok: true, patch: {} });
  });

  it("explains each bad field in a sentence", () => {
    expect(parseCustomsPatch({ hsCode: "94" })).toEqual({ ok: false, error: "HS code should be 6 to 10 digits, like 9405.20." });
    expect(parseCustomsPatch({ originCountry: "Atlantis" })).toEqual({
      ok: false,
      error: "Country of origin should be a two-letter code, like US or CN.",
    });
    expect(parseCustomsPatch({ customsDescription: "x".repeat(101) })).toEqual({
      ok: false,
      error: "Customs description should be 100 characters or fewer.",
    });
    for (const value of [0, -5, 12.5, "abc"]) {
      expect(parseCustomsPatch({ customsValueCents: value })).toEqual({ ok: false, error: "Declared value should be above $0." });
    }
    expect(parseCustomsPatch({ hsCode: 940520 })).toEqual({ ok: false, error: "HS code must be text." });
  });
});
