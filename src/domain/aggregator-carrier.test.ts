import { describe, expect, it } from "vitest";
import {
  easyPostLabelUrl,
  easyPostShipmentBody,
  shipEngineLabelBody,
  shipEngineLabelUrl,
  shipEngineRateBody,
} from "./aggregator-carrier";

const building = { name: "Northwind", street1: "14 Dock St", city: "Portland", state: "OR", zip: "97209", country: "US" };
const customer = { name: "Ada Park", street1: "9 Bay Ave", city: "Austin", state: "TX", zip: "78701", country: "US" };
const parcel = { weightOz: 20, lengthIn: 12, widthIn: 9, heightIn: 6 };

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
});
