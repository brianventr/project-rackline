import { describe, expect, it } from "vitest";
import {
  dhlShipmentBody,
  directServiceCode,
  fedexRateBody,
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
});
