import { describe, expect, it } from "vitest";
import {
  easyPostCustomsFormUrl,
  easyPostLabelUrl,
  easyPostShipmentBody,
  shipEngineCustomsFormUrl,
  shipEngineLabelBody,
  shipEngineLabelUrl,
  shipEngineRateBody,
} from "./aggregator-carrier";
import type { CustomsDeclaration } from "./customs";

const building = { name: "Northwind", street1: "14 Dock St", city: "Portland", state: "OR", zip: "97209", country: "US" };
const customer = { name: "Ada Park", street1: "9 Bay Ave", city: "Austin", state: "TX", zip: "78701", country: "US" };
const abroad = { name: "Lena Roy", street1: "22 King St W", city: "Toronto", state: "ON", zip: "M5H 1A1", country: "CA" };
const parcel = { weightOz: 20, lengthIn: 12, widthIn: 9, heightIn: 6 };
const customs: CustomsDeclaration = {
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
      weightOz: 16,
      hsCode: "940520",
      originCountry: "US",
    },
  ],
  valueCents: 9000,
  exportFiling: "NOEEI 30.36",
};

describe("EasyPost shipment body", () => {
  it("sends an outbound parcel the way it travels", () => {
    const body = easyPostShipmentBody({ shipFrom: building, shipTo: customer, parcel });
    expect(body.shipment.from_address.street1).toBe("14 Dock St");
    expect(body.shipment.to_address.street1).toBe("9 Bay Ave");
    expect(body.shipment.parcel).toEqual({ length: 12, width: 9, height: 6, weight: 20 });
    expect("is_return" in body.shipment).toBe(false);
  });

  it("addresses a return like the outbound shipment and lets EasyPost swap it", () => {
    const body = easyPostShipmentBody({
      shipFrom: customer,
      shipTo: building,
      parcel,
      returnLabel: { rmaNumber: "RMA-1001" },
    });
    expect(body.shipment).toMatchObject({ is_return: true, reference: "RMA-1001" });
    expect(body.shipment.to_address.name).toBe("Ada Park");
    expect(body.shipment.from_address.name).toBe("Northwind");
  });
});

describe("ShipEngine bodies", () => {
  it("rates and buys an outbound label without return fields", () => {
    expect(shipEngineRateBody({ shipFrom: building, shipTo: customer, parcel }).shipment.ship_to.city_locality).toBe("Austin");
    const body = shipEngineLabelBody({ serviceId: "usps_priority", shipFrom: building, shipTo: customer, parcel });
    expect(body.shipment.service_code).toBe("usps_priority_mail");
    expect(body.shipment.packages[0]!.weight).toEqual({ value: 20, unit: "ounce" });
    expect("is_return_label" in body).toBe(false);
  });

  it("buys a return in the direction it travels, with the RMA number", () => {
    const body = shipEngineLabelBody({
      serviceId: "ups_ground",
      shipFrom: customer,
      shipTo: building,
      parcel,
      returnLabel: { rmaNumber: "RMA-1001" },
    });
    expect(body).toMatchObject({ is_return_label: true, rma_number: "RMA-1001" });
    expect(body.shipment.ship_from.name).toBe("Ada Park");
    expect(body.shipment.ship_to.name).toBe("Northwind");
  });
});

describe("label links", () => {
  it("prefers the PDF and ignores anything that is not a web link", () => {
    expect(easyPostLabelUrl({ postage_label: { label_url: "https://ep.example/l.png", label_pdf_url: "https://ep.example/l.pdf" } })).toBe(
      "https://ep.example/l.pdf",
    );
    expect(easyPostLabelUrl({ postage_label: { label_url: "https://ep.example/l.png" } })).toBe("https://ep.example/l.png");
    expect(easyPostLabelUrl({ postage_label: { label_url: "javascript:alert(1)" } })).toBeNull();
    expect(easyPostLabelUrl({})).toBeNull();
    expect(shipEngineLabelUrl({ label_download: { pdf: "https://se.example/l.pdf", href: "https://se.example/l" } })).toBe(
      "https://se.example/l.pdf",
    );
    expect(shipEngineLabelUrl({ label_download: { href: "https://se.example/l" } })).toBe("https://se.example/l");
    expect(shipEngineLabelUrl(null)).toBeNull();
  });

  it("finds the customs form and nothing else", () => {
    const forms = [
      { form_type: "label_qr_code", form_url: "https://ep.example/qr.png" },
      { form_type: "commercial_invoice", form_url: "https://ep.example/ci.pdf" },
    ];
    expect(easyPostCustomsFormUrl({ forms })).toBe("https://ep.example/ci.pdf");
    expect(easyPostCustomsFormUrl({ forms: [forms[0]] })).toBeNull();
    expect(easyPostCustomsFormUrl({ forms: [{ form_type: "cn23", form_url: "ftp://nope" }] })).toBeNull();
    expect(easyPostCustomsFormUrl({})).toBeNull();
    expect(shipEngineCustomsFormUrl({ form_download: { href: "https://se.example/form.pdf" } })).toBe("https://se.example/form.pdf");
    expect(shipEngineCustomsFormUrl({ label_download: { href: "https://se.example/l" } })).toBeNull();
  });
});

describe("customs on international bodies", () => {
  it("EasyPost declares line totals, the tariff code, and the export exemption", () => {
    const body = easyPostShipmentBody({ shipFrom: building, shipTo: abroad, parcel, customs });
    expect(body.shipment.customs_info).toEqual({
      contents_type: "merchandise",
      customs_certify: true,
      customs_signer: "Northwind Makers",
      non_delivery_option: "return",
      restriction_type: "none",
      eel_pfc: "NOEEI 30.36",
      customs_items: [
        {
          description: "Desk lamp",
          quantity: 2,
          value: 90,
          weight: 16,
          hs_tariff_number: "940520",
          origin_country: "US",
          code: "LAMP",
          currency: "USD",
        },
      ],
    });
    expect("customs_info" in easyPostShipmentBody({ shipFrom: building, shipTo: customer, parcel }).shipment).toBe(false);
  });

  it("ShipEngine declares the per-unit value on both the rate and the label", () => {
    const expected = {
      contents: "merchandise",
      non_delivery: "return_to_sender",
      customs_items: [
        {
          description: "Desk lamp",
          quantity: 2,
          value: { currency: "usd", amount: 45 },
          harmonized_tariff_code: "940520",
          country_of_origin: "US",
          sku: "LAMP",
        },
      ],
    };
    expect(shipEngineRateBody({ shipFrom: building, shipTo: abroad, parcel, customs }).shipment.customs).toEqual(expected);
    expect(shipEngineLabelBody({ serviceId: "ups_ground", shipFrom: building, shipTo: abroad, parcel, customs }).shipment.customs).toEqual(
      expected,
    );
    expect("customs" in shipEngineLabelBody({ serviceId: "ups_ground", shipFrom: building, shipTo: customer, parcel }).shipment).toBe(false);
  });
});
