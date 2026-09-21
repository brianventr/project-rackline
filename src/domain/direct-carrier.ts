import type { LiveShipAddress, ParcelDims } from "./carrier-live";

export const DIRECT_PROVIDERS = ["ups", "fedex", "usps", "dhl"] as const;
export type DirectProvider = (typeof DIRECT_PROVIDERS)[number];

export function isDirectProvider(value: string): value is DirectProvider {
  return (DIRECT_PROVIDERS as readonly string[]).includes(value);
}

export function directClientSecret(input: {
  provider: DirectProvider;
  apiSecret?: string | null;
  meterNumber?: string | null;
}): string | null {
  if (input.provider === "ups") return input.apiSecret?.trim() || null;
  if (input.provider === "fedex") return input.meterNumber?.trim() || null;
  return null;
}

export function poundsFromOz(weightOz: number): number {
  return Math.max(0.1, Math.round((weightOz / 16) * 10) / 10);
}

const UPS_CODES: Record<string, string> = {
  ups_ground: "03",
  ups_2day: "02",
  ups_next_day: "01",
};

const FEDEX_CODES: Record<string, string> = {
  fedex_ground: "FEDEX_GROUND",
  fedex_home: "GROUND_HOME_DELIVERY",
  fedex_2day: "FEDEX_2_DAY",
};

const USPS_CODES: Record<string, string> = {
  usps_priority: "PRIORITY_MAIL",
  usps_ground_advantage: "USPS_GROUND_ADVANTAGE",
  usps_express: "PRIORITY_MAIL_EXPRESS",
};

const DHL_CODES: Record<string, string> = {
  dhl_express: "P",
};

const CODE_TABLE: Record<DirectProvider, Record<string, string>> = {
  ups: UPS_CODES,
  fedex: FEDEX_CODES,
  usps: USPS_CODES,
  dhl: DHL_CODES,
};

export function directServiceCode(provider: DirectProvider, serviceId: string): string {
  const code = CODE_TABLE[provider][serviceId];
  if (!code) throw new Error(`Unknown ${provider} service ${serviceId}`);
  return code;
}

export function serviceIdForDirectCode(provider: DirectProvider, code: string): string | null {
  const hit = Object.entries(CODE_TABLE[provider]).find(([, value]) => value === code);
  return hit?.[0] ?? null;
}

export type ParsedDirectLabel = {
  trackingNumber: string;
  shipmentId: string | null;
  labelId: string | null;
  postageCents: number | null;
  trackingUrl: string | null;
};

export type ParsedDirectRate = {
  serviceId: string;
  amountCents: number;
  transitDays: number | null;
};

function cents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function upsParty(name: string, address: LiveShipAddress, accountNumber?: string) {
  return {
    Name: name,
    ...(accountNumber ? { ShipperNumber: accountNumber } : {}),
    Address: {
      AddressLine: [address.street1, address.street2].filter(Boolean),
      City: address.city,
      StateProvinceCode: address.state,
      PostalCode: address.zip,
      CountryCode: address.country,
    },
  };
}

export function upsShipment(input: {
  accountNumber: string;
  serviceId: string;
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
}) {
  const weight = poundsFromOz(input.parcel.weightOz).toFixed(1);
  return {
    Description: "Rackline",
    Shipper: upsParty(input.shipFrom.name, input.shipFrom, input.accountNumber),
    ShipTo: upsParty(input.shipTo.name, input.shipTo),
    ShipFrom: upsParty(input.shipFrom.name, input.shipFrom),
    PaymentInformation: {
      ShipmentCharge: { Type: "01", BillShipper: { AccountNumber: input.accountNumber } },
    },
    Service: { Code: directServiceCode("ups", input.serviceId) },
    Package: {
      Packaging: { Code: "02" },
      Dimensions: {
        UnitOfMeasurement: { Code: "IN" },
        Length: String(input.parcel.lengthIn),
        Width: String(input.parcel.widthIn),
        Height: String(input.parcel.heightIn),
      },
      PackageWeight: { UnitOfMeasurement: { Code: "LBS" }, Weight: weight },
    },
  };
}

export function upsShipBody(input: Parameters<typeof upsShipment>[0]) {
  return {
    ShipmentRequest: {
      Request: { RequestOption: "nonvalidate" },
      Shipment: upsShipment(input),
      LabelSpecification: { LabelImageFormat: { Code: "GIF" } },
    },
  };
}

export function upsRateBody(input: Omit<Parameters<typeof upsShipment>[0], "serviceId"> & { serviceId?: string }) {
  const shipment = input.serviceId
    ? upsShipment({ ...input, serviceId: input.serviceId })
    : { ...upsShipment({ ...input, serviceId: "ups_ground" }) };
  if (!input.serviceId) {
    delete (shipment as { Service?: unknown }).Service;
  }
  return { RateRequest: { Request: { RequestOption: "Shop" }, Shipment: shipment } };
}

export function parseUpsLabel(payload: unknown): ParsedDirectLabel | null {
  const results = asRecord(asRecord(payload)?.ShipmentResponse)?.ShipmentResults;
  const row = asRecord(results);
  if (!row) return null;
  const packages = row.PackageResults;
  const pkg = asRecord(Array.isArray(packages) ? packages[0] : packages);
  const tracking = typeof pkg?.TrackingNumber === "string" ? pkg.TrackingNumber.trim() : "";
  if (!tracking) return null;
  const charges = asRecord(asRecord(row.ShipmentCharges)?.TotalCharges);
  const shipmentId = typeof row.ShipmentIdentificationNumber === "string" ? row.ShipmentIdentificationNumber : null;
  return {
    trackingNumber: tracking,
    shipmentId,
    labelId: shipmentId,
    postageCents: cents(charges?.MonetaryValue),
    trackingUrl: `https://www.ups.com/track?tracknum=${encodeURIComponent(tracking)}`,
  };
}

export function parseUpsRates(payload: unknown): ParsedDirectRate[] {
  const rated = asRecord(asRecord(payload)?.RateResponse)?.RatedShipment;
  const list = Array.isArray(rated) ? rated : rated ? [rated] : [];
  const rates: ParsedDirectRate[] = [];
  for (const entry of list) {
    const row = asRecord(entry);
    const code = asRecord(row?.Service)?.Code;
    if (typeof code !== "string") continue;
    const serviceId = serviceIdForDirectCode("ups", code);
    const amountCents = cents(asRecord(row?.TotalCharges)?.MonetaryValue);
    if (!serviceId || amountCents == null) continue;
    const days = Number(asRecord(row?.GuaranteedDelivery)?.BusinessDaysInTransit);
    rates.push({ serviceId, amountCents, transitDays: Number.isFinite(days) && days > 0 ? days : null });
  }
  return rates;
}

function fedexAddress(address: LiveShipAddress) {
  return {
    streetLines: [address.street1, address.street2].filter(Boolean),
    city: address.city,
    stateOrProvinceCode: address.state,
    postalCode: address.zip,
    countryCode: address.country,
  };
}

export function fedexShipBody(input: {
  accountNumber: string;
  serviceId: string;
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
}) {
  return {
    labelResponseOptions: "URL_ONLY",
    accountNumber: { value: input.accountNumber },
    requestedShipment: {
      shipper: { contact: { personName: input.shipFrom.name }, address: fedexAddress(input.shipFrom) },
      recipients: [{ contact: { personName: input.shipTo.name }, address: fedexAddress(input.shipTo) }],
      serviceType: directServiceCode("fedex", input.serviceId),
      packagingType: "YOUR_PACKAGING",
      pickupType: "DROPOFF_AT_FEDEX_LOCATION",
      shippingChargesPayment: { paymentType: "SENDER" },
      labelSpecification: { imageType: "PDF", labelStockType: "PAPER_4X6" },
      requestedPackageLineItems: [
        {
          weight: { units: "LB", value: poundsFromOz(input.parcel.weightOz) },
          dimensions: {
            length: input.parcel.lengthIn,
            width: input.parcel.widthIn,
            height: input.parcel.heightIn,
            units: "IN",
          },
        },
      ],
    },
  };
}

export function parseFedexLabel(payload: unknown): ParsedDirectLabel | null {
  const shipment = asRecord(asRecord(asRecord(payload)?.output)?.transactionShipments);
  const list = Array.isArray(asRecord(payload)?.output && (asRecord(payload)?.output as { transactionShipments?: unknown }).transactionShipments)
    ? ((asRecord(payload)?.output as { transactionShipments: unknown[] }).transactionShipments)
    : [];
  const first = asRecord(list[0] ?? shipment);
  if (!first) return null;
  const piece = asRecord(Array.isArray(first.pieceResponses) ? first.pieceResponses[0] : first.pieceResponses);
  const tracking =
    (typeof first.masterTrackingNumber === "string" && first.masterTrackingNumber.trim()) ||
    (typeof piece?.trackingNumber === "string" && piece.trackingNumber.trim()) ||
    "";
  if (!tracking) return null;
  const rating = asRecord(asRecord(first.completedShipmentDetail)?.shipmentRating);
  const detail = asRecord(Array.isArray(rating?.shipmentRateDetails) ? rating.shipmentRateDetails[0] : rating?.shipmentRateDetails);
  return {
    trackingNumber: tracking,
    shipmentId: tracking,
    labelId: tracking,
    postageCents: cents(detail?.totalNetCharge ?? piece?.baseRateAmount),
    trackingUrl: `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tracking)}`,
  };
}

export function parseFedexRates(payload: unknown): ParsedDirectRate[] {
  const details = asRecord(asRecord(payload)?.output)?.rateReplyDetails;
  const list = Array.isArray(details) ? details : [];
  const rates: ParsedDirectRate[] = [];
  for (const entry of list) {
    const row = asRecord(entry);
    const code = typeof row?.serviceType === "string" ? row.serviceType : "";
    const serviceId = serviceIdForDirectCode("fedex", code);
    const rated = asRecord(Array.isArray(row?.ratedShipmentDetails) ? row.ratedShipmentDetails[0] : row?.ratedShipmentDetails);
    const amountCents = cents(rated?.totalNetCharge);
    if (!serviceId || amountCents == null) continue;
    const days = Number(asRecord(row?.commit)?.transitDays);
    rates.push({ serviceId, amountCents, transitDays: Number.isFinite(days) && days > 0 ? days : null });
  }
  return rates;
}

export function uspsLabelBody(input: {
  accountNumber: string;
  serviceId: string;
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
}) {
  return {
    accountNumber: input.accountNumber,
    mailClass: directServiceCode("usps", input.serviceId),
    fromAddress: {
      streetAddress: input.shipFrom.street1,
      city: input.shipFrom.city,
      state: input.shipFrom.state,
      ZIPCode: input.shipFrom.zip,
    },
    toAddress: {
      streetAddress: input.shipTo.street1,
      city: input.shipTo.city,
      state: input.shipTo.state,
      ZIPCode: input.shipTo.zip,
    },
    packageDescription: {
      weight: poundsFromOz(input.parcel.weightOz),
      length: input.parcel.lengthIn,
      width: input.parcel.widthIn,
      height: input.parcel.heightIn,
    },
  };
}

export function parseUspsLabel(payload: unknown): ParsedDirectLabel | null {
  const row = asRecord(payload);
  const meta = asRecord(row?.labelMetadata);
  const tracking =
    (typeof row?.trackingNumber === "string" && row.trackingNumber.trim()) ||
    (typeof meta?.trackingNumber === "string" && meta.trackingNumber.trim()) ||
    "";
  if (!tracking) return null;
  return {
    trackingNumber: tracking,
    shipmentId: tracking,
    labelId: tracking,
    postageCents: cents(row?.postage ?? meta?.postage),
    trackingUrl: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tracking)}`,
  };
}

export function parseUspsRate(payload: unknown, serviceId: string): ParsedDirectRate[] {
  const row = asRecord(payload);
  const amountCents = cents(row?.totalBasePrice ?? row?.price);
  if (amountCents == null) return [];
  return [{ serviceId, amountCents, transitDays: null }];
}

export function dhlShipmentBody(input: {
  accountNumber: string;
  serviceId: string;
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
}) {
  const planned = new Date().toISOString().slice(0, 10);
  return {
    plannedShippingDateAndTime: `${planned}T12:00:00 GMT+00:00`,
    pickup: { isRequested: false },
    productCode: directServiceCode("dhl", input.serviceId),
    accounts: [{ typeCode: "shipper", number: input.accountNumber }],
    customerDetails: {
      shipperDetails: {
        postalAddress: {
          cityName: input.shipFrom.city,
          postalCode: input.shipFrom.zip,
          countryCode: input.shipFrom.country,
          addressLine1: input.shipFrom.street1,
        },
        contactInformation: { fullName: input.shipFrom.name, phone: "0000000000", companyName: input.shipFrom.name },
      },
      receiverDetails: {
        postalAddress: {
          cityName: input.shipTo.city,
          postalCode: input.shipTo.zip,
          countryCode: input.shipTo.country,
          addressLine1: input.shipTo.street1,
        },
        contactInformation: { fullName: input.shipTo.name, phone: "0000000000", companyName: input.shipTo.name },
      },
    },
    content: {
      packages: [
        {
          weight: poundsFromOz(input.parcel.weightOz),
          dimensions: { length: input.parcel.lengthIn, width: input.parcel.widthIn, height: input.parcel.heightIn },
        },
      ],
      isCustomsDeclarable: false,
      description: "Rackline",
      unitOfMeasurement: "imperial",
      incoterm: "DAP",
    },
  };
}

export function parseDhlLabel(payload: unknown): ParsedDirectLabel | null {
  const row = asRecord(payload);
  const tracking = typeof row?.shipmentTrackingNumber === "string" ? row.shipmentTrackingNumber.trim() : "";
  if (!tracking) return null;
  const charge = Array.isArray(row?.shipmentCharges) ? asRecord(row.shipmentCharges[0]) : null;
  return {
    trackingNumber: tracking,
    shipmentId: tracking,
    labelId: tracking,
    postageCents: cents(charge?.price),
    trackingUrl: `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${encodeURIComponent(tracking)}`,
  };
}

export function fedexRateBody(input: Omit<Parameters<typeof fedexShipBody>[0], "serviceId">) {
  const ship = fedexShipBody({ ...input, serviceId: "fedex_ground" });
  const requested = { ...ship.requestedShipment } as Record<string, unknown>;
  delete requested.serviceType;
  delete requested.labelSpecification;
  const recipients = requested.recipients;
  delete requested.recipients;
  const recipient = Array.isArray(recipients) ? recipients[0] : recipients;
  return {
    accountNumber: ship.accountNumber,
    requestedShipment: {
      ...requested,
      recipient,
      rateRequestType: ["ACCOUNT", "LIST"],
    },
  };
}

export function uspsRateBody(input: Parameters<typeof uspsLabelBody>[0]) {
  const label = uspsLabelBody(input);
  return {
    originZIPCode: input.shipFrom.zip,
    destinationZIPCode: input.shipTo.zip,
    weight: label.packageDescription.weight,
    length: input.parcel.lengthIn,
    width: input.parcel.widthIn,
    height: input.parcel.heightIn,
    mailClass: label.mailClass,
    priceType: "RETAIL",
    accountNumber: input.accountNumber,
  };
}

export function dhlRateQuery(input: Omit<Parameters<typeof dhlShipmentBody>[0], "serviceId">): string {
  const params = new URLSearchParams({
    accountNumber: input.accountNumber,
    originCountryCode: input.shipFrom.country,
    originPostalCode: input.shipFrom.zip,
    destinationCountryCode: input.shipTo.country,
    destinationPostalCode: input.shipTo.zip,
    weight: String(poundsFromOz(input.parcel.weightOz)),
    length: String(input.parcel.lengthIn),
    width: String(input.parcel.widthIn),
    height: String(input.parcel.heightIn),
    plannedShippingDate: new Date().toISOString().slice(0, 10),
    isCustomsDeclarable: "false",
    unitOfMeasurement: "imperial",
  });
  return params.toString();
}

export function parseDhlRates(payload: unknown): ParsedDirectRate[] {
  const products = asRecord(payload)?.products;
  const list = Array.isArray(products) ? products : [];
  const rates: ParsedDirectRate[] = [];
  for (const entry of list) {
    const row = asRecord(entry);
    const code = typeof row?.productCode === "string" ? row.productCode : "";
    const serviceId = serviceIdForDirectCode("dhl", code) ?? (code ? "dhl_express" : null);
    const prices = Array.isArray(row?.totalPrice) ? row.totalPrice : [];
    const usd = prices.map((price) => asRecord(price)).find((price) => price?.priceCurrency === "USD") ?? asRecord(prices[0]);
    const amountCents = cents(usd?.price);
    if (!serviceId || amountCents == null) continue;
    rates.push({ serviceId, amountCents, transitDays: null });
  }
  return rates;
}
