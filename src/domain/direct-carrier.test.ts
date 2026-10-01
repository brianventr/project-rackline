import { describe, expect, it } from "vitest";
import type { CustomsDeclaration } from "./customs";
import {
  dhlRateQuery,
  dhlShipmentBody,
  directCustomsRefusal,
  directServiceCode,
  fedexRateBody,
  fedexShipBody,
  parseDhlLabel,
  parseDhlRates,
  parseFedexLabel,
  parseFedexRates,
  parseUpsLabel,
  parseUpsRates,
  parseUspsLabel,
  parseUspsRate,
  poundsFromOz,
  upsRateBody,
  upsShipBody,
} from "./direct-carrier";

const from = {
  name: "Main",
  street1: "1 Dock St",
  city: "Dallas",
  state: "TX",
  zip: "75201",
  country: "US",
};
const to = {
  name: "Harbor",
  street1: "9 Bay Ave",
  city: "Austin",
  state: "TX",
  zip: "78701",
  country: "US",
};
const parcel = { weightOz: 16, lengthIn: 12, widthIn: 9, heightIn: 6 };

describe("direct carrier payloads", () => {
  it("converts ounces to pounds and maps service codes", () => {
    expect(poundsFromOz(16)).toBe(1);
    expect(poundsFromOz(1)).toBe(0.1);
    expect(directServiceCode("ups", "ups_ground")).toBe("03");
    expect(directServiceCode("fedex", "fedex_home")).toBe("GROUND_HOME_DELIVERY");
    expect(directServiceCode("usps", "usps_priority")).toBe("PRIORITY_MAIL");
    expect(directServiceCode("dhl", "dhl_express")).toBe("P");
  });

  it("parses UPS ship and shop responses", () => {
    const ship = upsShipBody({
      accountNumber: "A1",
      serviceId: "ups_ground",
      shipFrom: from,
      shipTo: to,
      parcel,
    });
    expect(ship.ShipmentRequest.Shipment.Service.Code).toBe("03");
    const shop = upsRateBody({ accountNumber: "A1", shipFrom: from, shipTo: to, parcel });
    expect(shop.RateRequest.Shipment.Service).toBeUndefined();
    expect(
      parseUpsLabel({
        ShipmentResponse: {
          ShipmentResults: {
            ShipmentIdentificationNumber: "1Z999",
            ShipmentCharges: { TotalCharges: { MonetaryValue: "12.40" } },
            PackageResults: { TrackingNumber: "1Z999" },
          },
        },
      }),
    ).toMatchObject({ trackingNumber: "1Z999", postageCents: 1240, shipmentId: "1Z999" });
    expect(
      parseUpsRates({
        RateResponse: {
          RatedShipment: {
            Service: { Code: "03" },
            TotalCharges: { MonetaryValue: "9.50" },
            GuaranteedDelivery: { BusinessDaysInTransit: "5" },
          },
        },
      }),
    ).toEqual([{ serviceId: "ups_ground", amountCents: 950, transitDays: 5 }]);
  });

  it("parses FedEx, USPS, and DHL responses", () => {
    const rated = fedexRateBody({ accountNumber: "FX", shipFrom: from, shipTo: to, parcel });
    expect("serviceType" in rated.requestedShipment).toBe(false);
    expect(
      parseFedexLabel({
        output: {
          transactionShipments: [
            {
              masterTrackingNumber: "7946",
              pieceResponses: [{ trackingNumber: "7946" }],
              completedShipmentDetail: { shipmentRating: { shipmentRateDetails: [{ totalNetCharge: 14.2 }] } },
            },
          ],
        },
      }),
    ).toMatchObject({ trackingNumber: "7946", postageCents: 1420 });
    expect(
      parseFedexRates({
        output: {
          rateReplyDetails: [
            {
              serviceType: "FEDEX_GROUND",
              commit: { transitDays: 4 },
              ratedShipmentDetails: [{ totalNetCharge: 8.25 }],
            },
          ],
        },
      }),
    ).toEqual([{ serviceId: "fedex_ground", amountCents: 825, transitDays: 4 }]);
    expect(parseUspsLabel({ trackingNumber: "940011", postage: 7.5 })).toMatchObject({
      trackingNumber: "940011",
      postageCents: 750,
    });
    expect(parseUspsRate({ totalBasePrice: 6.1 }, "usps_priority")).toEqual([
      { serviceId: "usps_priority", amountCents: 610, transitDays: null },
    ]);
    expect(dhlShipmentBody({ accountNumber: "DHL1", serviceId: "dhl_express", shipFrom: from, shipTo: to, parcel }).productCode).toBe(
      "P",
    );
    expect(parseDhlLabel({ shipmentTrackingNumber: "123456", shipmentCharges: [{ price: 22.1 }] })).toMatchObject({
      trackingNumber: "123456",
      postageCents: 2210,
    });
    expect(
      parseDhlRates({
        products: [
          { productCode: "P", totalPrice: [{ priceCurrency: "USD", price: 40.5 }] },
          { productCode: "Q", totalPrice: [{ priceCurrency: "EUR", price: 10 }] },
        ],
      }),
    ).toEqual([
      { serviceId: "dhl_express", amountCents: 4050, transitDays: null },
      { serviceId: "dhl_express", amountCents: 1000, transitDays: null },
    ]);
  });

  it("builds a FedEx return from the customer to the building and keeps its label link", () => {
    const outbound = fedexShipBody({ accountNumber: "FX", serviceId: "fedex_ground", shipFrom: from, shipTo: to, parcel });
    expect("shipmentSpecialServices" in outbound.requestedShipment).toBe(false);
    const ret = fedexShipBody({
      accountNumber: "FX",
      serviceId: "fedex_ground",
      shipFrom: to,
      shipTo: from,
      parcel,
      returnLabel: { rmaNumber: "RMA-7" },
    });
    expect(ret.requestedShipment.shipper.contact.personName).toBe("Harbor");
    expect(ret.requestedShipment.recipients[0]!.contact.personName).toBe("Main");
    expect(ret.requestedShipment).toMatchObject({
      shipmentSpecialServices: {
        specialServiceTypes: ["RETURN_SHIPMENT"],
        returnShipmentDetail: { returnType: "PRINT_RETURN_LABEL" },
      },
    });
    expect(ret.requestedShipment.requestedPackageLineItems[0]).toMatchObject({
      customerReferences: [{ customerReferenceType: "RMA_ASSOCIATION", value: "RMA-7" }],
    });
    expect(
      parseFedexLabel({
        output: {
          transactionShipments: [
            {
              masterTrackingNumber: "7950",
              pieceResponses: [{ trackingNumber: "7950", packageDocuments: [{ contentType: "LABEL", url: "https://fx.example/l.pdf" }] }],
            },
          ],
        },
      }),
    ).toMatchObject({ trackingNumber: "7950", labelUrl: "https://fx.example/l.pdf" });
  });
});

describe("international direct labels", () => {
  const abroad = { name: "Lena Roy", street1: "22 King St W", city: "Toronto", state: "ON", zip: "M5H 1A1", country: "CA" };
  const customs: CustomsDeclaration = {
    contents: "merchandise",
    signer: "Main",
    invoiceNumber: "#1004",
    currency: "USD",
    fromCountry: "US",
    toCountry: "CA",
    items: [
      { sku: "LAMP", description: "Desk lamp", qty: 2, unitValueCents: 4500, valueCents: 9000, weightOz: 48, hsCode: "940520", originCountry: "US" },
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
  };

  it("maps each service to the nearest international one and reads quotes back", () => {
    expect(directServiceCode("ups", "ups_ground", true)).toBe("11");
    expect(directServiceCode("fedex", "fedex_2day", true)).toBe("FEDEX_INTERNATIONAL_PRIORITY");
    expect(() => directServiceCode("usps", "usps_priority", true)).toThrow("Unknown international usps service usps_priority");
    expect(
      parseUpsRates({
        RateResponse: {
          RatedShipment: [
            { Service: { Code: "11" }, TotalCharges: { MonetaryValue: "31.00" } },
            { Service: { Code: "65" }, TotalCharges: { MonetaryValue: "40.00" } },
          ],
        },
      }),
    ).toEqual([{ serviceId: "ups_ground", amountCents: 3100, transitDays: null }]);
    expect(
      parseFedexRates({
        output: { rateReplyDetails: [{ serviceType: "INTERNATIONAL_PRIORITY", ratedShipmentDetails: [{ totalNetCharge: 55 }] }] },
      }),
    ).toEqual([{ serviceId: "fedex_2day", amountCents: 5500, transitDays: null }]);
  });

  it("UPS builds the commercial invoice from the declaration", () => {
    const shipment = upsShipBody({
      accountNumber: "A1",
      serviceId: "ups_ground",
      shipFrom: from,
      shipTo: abroad,
      parcel,
      customs,
      date: new Date("2026-10-01T12:00:00Z"),
    }).ShipmentRequest.Shipment;
    expect(shipment.Service.Code).toBe("11");
    expect(shipment.Description).toBe("Desk lamp, Lamp shade, linen");
    expect(shipment.InvoiceLineTotal).toEqual({ CurrencyCode: "USD", MonetaryValue: "108.00" });
    const forms = shipment.ShipmentServiceOptions!.InternationalForms;
    expect(forms).toMatchObject({ FormType: "01", InvoiceNumber: "#1004", InvoiceDate: "20261001", ReasonForExport: "SALE" });
    expect(forms.Contacts.SoldTo.Address.CountryCode).toBe("CA");
    expect(forms.Product[0]).toEqual({
      Description: ["Desk lamp"],
      Unit: { Number: "2", Value: "45.00", UnitOfMeasurement: { Code: "PCS" } },
      CommodityCode: "940520",
      OriginCountryCode: "US",
    });
    const domestic = upsShipBody({ accountNumber: "A1", serviceId: "ups_ground", shipFrom: from, shipTo: to, parcel }).ShipmentRequest.Shipment;
    expect("ShipmentServiceOptions" in domestic).toBe(false);
    expect(domestic.Service.Code).toBe("03");
  });

  it("FedEx declares each commodity, asks for its invoice, and keeps the invoice link", () => {
    const shipment = fedexShipBody({ accountNumber: "FX", serviceId: "fedex_ground", shipFrom: from, shipTo: abroad, parcel, customs })
      .requestedShipment;
    expect(shipment.serviceType).toBe("INTERNATIONAL_ECONOMY");
    expect(shipment.customsClearanceDetail).toMatchObject({
      dutiesPayment: { paymentType: "RECIPIENT" },
      totalCustomsValue: { amount: 108, currency: "USD" },
    });
    expect(shipment.customsClearanceDetail?.commodities[0]).toEqual({
      description: "Desk lamp",
      countryOfManufacture: "US",
      harmonizedCode: "940520",
      quantity: 2,
      quantityUnits: "PCS",
      unitPrice: { amount: 45, currency: "USD" },
      customsValue: { amount: 90, currency: "USD" },
      weight: { units: "LB", value: 3 },
    });
    expect(shipment.shippingDocumentSpecification?.shippingDocumentTypes).toEqual(["COMMERCIAL_INVOICE"]);
    const rated = fedexRateBody({ accountNumber: "FX", shipFrom: from, shipTo: abroad, parcel, customs }).requestedShipment;
    expect("shippingDocumentSpecification" in rated).toBe(false);
    expect("customsClearanceDetail" in rated).toBe(true);
    expect(
      parseFedexLabel({
        output: {
          transactionShipments: [
            {
              masterTrackingNumber: "7960",
              shipmentDocuments: [{ contentType: "COMMERCIAL_INVOICE", url: "https://fx.example/ci.pdf" }],
            },
          ],
        },
      }),
    ).toMatchObject({ trackingNumber: "7960", customsFormUrl: "https://fx.example/ci.pdf" });
  });

  it("DHL marks the parcel declarable and lists each line", () => {
    const content = dhlShipmentBody({ accountNumber: "DHL1", serviceId: "dhl_express", shipFrom: from, shipTo: abroad, parcel, customs }).content;
    expect(content).toMatchObject({
      isCustomsDeclarable: true,
      declaredValue: 108,
      declaredValueCurrency: "USD",
      description: "Desk lamp, Lamp shade, linen",
    });
    expect(content.exportDeclaration?.invoice.number).toBe("#1004");
    expect(content.exportDeclaration?.lineItems[1]).toMatchObject({
      number: 2,
      price: 18,
      quantity: { value: 1, unitOfMeasurement: "PCS" },
      commodityCodes: [{ typeCode: "outbound", value: "940599" }],
      manufacturerCountry: "PT",
    });
    expect(dhlShipmentBody({ accountNumber: "DHL1", serviceId: "dhl_express", shipFrom: from, shipTo: to, parcel }).content.isCustomsDeclarable).toBe(
      false,
    );
    const query = new URLSearchParams(dhlRateQuery({ accountNumber: "DHL1", shipFrom: from, shipTo: abroad, parcel, customs }));
    expect(query.get("isCustomsDeclarable")).toBe("true");
  });

  it("refuses a direct USPS international label in plain words", () => {
    expect(directCustomsRefusal("usps")).toBe(
      "A direct USPS account cannot buy international labels in Rackline yet. Choose a USPS service on EasyPost or ShipEngine.",
    );
    for (const provider of ["ups", "fedex", "dhl"] as const) expect(directCustomsRefusal(provider)).toBeNull();
  });
});
