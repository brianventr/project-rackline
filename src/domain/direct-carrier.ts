import type { LiveShipAddress, ParcelDims, ReturnLabelRequest } from "./carrier-live";
import type { CustomsDeclaration } from "./customs";

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

/** The nearest international service for each domestic one: UPS Standard, Expedited, and Express; FedEx Economy and Priority. */
const INTL_CODE_TABLE: Partial<Record<DirectProvider, Record<string, string>>> = {
  ups: { ups_ground: "11", ups_2day: "08", ups_next_day: "07" },
  fedex: { fedex_ground: "INTERNATIONAL_ECONOMY", fedex_home: "INTERNATIONAL_ECONOMY", fedex_2day: "FEDEX_INTERNATIONAL_PRIORITY" },
  dhl: DHL_CODES,
};

/** FedEx still answers rate requests with the service's older name now and then. */
const RATE_CODE_ALIASES: Partial<Record<DirectProvider, Record<string, string>>> = {
  fedex: { INTERNATIONAL_PRIORITY: "fedex_2day" },
};

export function directServiceCode(provider: DirectProvider, serviceId: string, international = false): string {
  const code = (international ? INTL_CODE_TABLE[provider] : CODE_TABLE[provider])?.[serviceId];
  if (!code) throw new Error(`Unknown ${international ? "international " : ""}${provider} service ${serviceId}`);
  return code;
}

export function serviceIdForDirectCode(provider: DirectProvider, code: string): string | null {
  for (const table of [CODE_TABLE[provider], INTL_CODE_TABLE[provider] ?? {}]) {
    const hit = Object.entries(table).find(([, value]) => value === code);
    if (hit) return hit[0];
  }
  return RATE_CODE_ALIASES[provider]?.[code] ?? null;
}

/** Why a direct account cannot take this international label, or null when it can. */
export function directCustomsRefusal(provider: DirectProvider): string | null {
  return provider === "usps"
    ? "A direct USPS account cannot buy international labels in Rackline yet. Choose a USPS service on EasyPost or ShipEngine."
    : null;
}

function dollars(cents: number): number {
  return Math.round(cents) / 100;
}

export type ParsedDirectLabel = {
  trackingNumber: string;
  shipmentId: string | null;
  labelId: string | null;
  postageCents: number | null;
  trackingUrl: string | null;
  labelUrl?: string | null;
  customsFormUrl?: string | null;
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
  customs?: CustomsDeclaration | null;
}) {
  const weight = poundsFromOz(input.parcel.weightOz).toFixed(1);
  const customs = input.customs ?? null;
  return {
    Description: customs ? customs.items.map((item) => item.description).join(", ").slice(0, 50) : "Rackline",
    Shipper: upsParty(input.shipFrom.name, input.shipFrom, input.accountNumber),
    ShipTo: upsParty(input.shipTo.name, input.shipTo),
    ShipFrom: upsParty(input.shipFrom.name, input.shipFrom),
    PaymentInformation: {
      ShipmentCharge: { Type: "01", BillShipper: { AccountNumber: input.accountNumber } },
    },
    Service: { Code: directServiceCode("ups", input.serviceId, Boolean(customs)) },
    ...(customs
      ? { InvoiceLineTotal: { CurrencyCode: customs.currency, MonetaryValue: dollars(customs.valueCents).toFixed(2) } }
      : {}),
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

/** UPS takes product descriptions as up to three lines of 35 characters. */
function upsDescription(text: string): string[] {
  const lines: string[] = [];
  for (let at = 0; at < text.length && lines.length < 3; at += 35) lines.push(text.slice(at, at + 35));
  return lines;
}

/** The commercial invoice UPS builds from the shipment; it bills the customer in `SoldTo`. */
export function upsInternationalForms(customs: CustomsDeclaration, soldTo: LiveShipAddress, date: Date) {
  return {
    FormType: "01",
    InvoiceNumber: customs.invoiceNumber,
    InvoiceDate: date.toISOString().slice(0, 10).replaceAll("-", ""),
    ReasonForExport: "SALE",
    CurrencyCode: customs.currency,
    Contacts: { SoldTo: { ...upsParty(soldTo.name, soldTo), AttentionName: soldTo.name } },
    Product: customs.items.map((item) => ({
      Description: upsDescription(item.description),
      Unit: {
        Number: String(item.qty),
        Value: dollars(item.unitValueCents).toFixed(2),
        UnitOfMeasurement: { Code: "PCS" },
      },
      CommodityCode: item.hsCode,
      OriginCountryCode: item.originCountry,
    })),
  };
}

export function upsShipBody(input: Parameters<typeof upsShipment>[0] & { date?: Date }) {
  const customs = input.customs ?? null;
  return {
    ShipmentRequest: {
      Request: { RequestOption: "nonvalidate" },
      Shipment: {
        ...upsShipment(input),
        ...(customs
          ? { ShipmentServiceOptions: { InternationalForms: upsInternationalForms(customs, input.shipTo, input.date ?? new Date()) } }
          : {}),
      },
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

export function fedexCustomsClearance(customs: CustomsDeclaration) {
  return {
    dutiesPayment: { paymentType: "RECIPIENT" },
    isDocumentOnly: false,
    totalCustomsValue: { amount: dollars(customs.valueCents), currency: customs.currency },
    commodities: customs.items.map((item) => ({
      description: item.description,
      countryOfManufacture: item.originCountry,
      harmonizedCode: item.hsCode,
      quantity: item.qty,
      quantityUnits: "PCS",
      unitPrice: { amount: dollars(item.unitValueCents), currency: customs.currency },
      customsValue: { amount: dollars(item.valueCents), currency: customs.currency },
      weight: { units: "LB", value: poundsFromOz(item.weightOz) },
    })),
  };
}

/**
 * A FedEx return keeps the direction it travels: the customer is the shipper and the building the
 * recipient, with the account in the request paying for it.
 */
export function fedexShipBody(input: {
  accountNumber: string;
  serviceId: string;
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
  returnLabel?: ReturnLabelRequest | null;
  customs?: CustomsDeclaration | null;
}) {
  const ret = input.returnLabel ?? null;
  const customs = input.customs ?? null;
  return {
    labelResponseOptions: "URL_ONLY",
    accountNumber: { value: input.accountNumber },
    requestedShipment: {
      shipper: { contact: { personName: input.shipFrom.name }, address: fedexAddress(input.shipFrom) },
      recipients: [{ contact: { personName: input.shipTo.name }, address: fedexAddress(input.shipTo) }],
      serviceType: directServiceCode("fedex", input.serviceId, Boolean(customs)),
      packagingType: "YOUR_PACKAGING",
      pickupType: "DROPOFF_AT_FEDEX_LOCATION",
      shippingChargesPayment: { paymentType: "SENDER" },
      ...(ret
        ? {
            shipmentSpecialServices: {
              specialServiceTypes: ["RETURN_SHIPMENT"],
              returnShipmentDetail: { returnType: "PRINT_RETURN_LABEL" },
            },
          }
        : {}),
      ...(customs
        ? {
            customsClearanceDetail: fedexCustomsClearance(customs),
            shippingDocumentSpecification: {
              shippingDocumentTypes: ["COMMERCIAL_INVOICE"],
              commercialInvoiceDetail: { documentFormat: { docType: "PDF", stockType: "PAPER_LETTER" } },
            },
          }
        : {}),
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
          ...(ret ? { customerReferences: [{ customerReferenceType: "RMA_ASSOCIATION", value: ret.rmaNumber }] } : {}),
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
  const documents = Array.isArray(piece?.packageDocuments) ? piece.packageDocuments : [];
  const labelUrl = documents
    .map((doc) => asRecord(doc)?.url)
    .find((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url));
  const shipmentDocuments = Array.isArray(first.shipmentDocuments) ? first.shipmentDocuments : [];
  const invoice = shipmentDocuments
    .map((doc) => asRecord(doc))
    .find((doc) => typeof doc?.url === "string" && /^https?:\/\//i.test(doc.url) && /INVOICE/i.test(String(doc.contentType ?? "INVOICE")));
  return {
    trackingNumber: tracking,
    shipmentId: tracking,
    labelId: tracking,
    postageCents: cents(detail?.totalNetCharge ?? piece?.baseRateAmount),
    trackingUrl: `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tracking)}`,
    labelUrl: labelUrl ?? null,
    customsFormUrl: typeof invoice?.url === "string" ? invoice.url : null,
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

export function dhlExportDeclaration(customs: CustomsDeclaration, invoiceDate: string) {
  return {
    lineItems: customs.items.map((item, index) => ({
      number: index + 1,
      description: item.description,
      price: dollars(item.unitValueCents),
      quantity: { value: item.qty, unitOfMeasurement: "PCS" },
      commodityCodes: [{ typeCode: "outbound", value: item.hsCode }],
      exportReasonType: "permanent",
      manufacturerCountry: item.originCountry,
      weight: { netValue: poundsFromOz(item.weightOz), grossValue: poundsFromOz(item.weightOz) },
    })),
    invoice: { number: customs.invoiceNumber, date: invoiceDate },
    exportReason: "Sale",
  };
}

export function dhlShipmentBody(input: {
  accountNumber: string;
  serviceId: string;
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
  customs?: CustomsDeclaration | null;
}) {
  const planned = new Date().toISOString().slice(0, 10);
  const customs = input.customs ?? null;
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
      isCustomsDeclarable: Boolean(customs),
      ...(customs
        ? {
            declaredValue: dollars(customs.valueCents),
            declaredValueCurrency: customs.currency,
            exportDeclaration: dhlExportDeclaration(customs, planned),
          }
        : {}),
      description: customs ? customs.items.map((item) => item.description).join(", ").slice(0, 70) : "Rackline",
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
  delete requested.shippingDocumentSpecification;
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
    isCustomsDeclarable: input.customs ? "true" : "false",
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
