import { shipEngineServiceCode, type LiveShipAddress, type ParcelDims, type ReturnLabelRequest } from "./carrier-live";
import type { CustomsDeclaration } from "./customs";

type Route = {
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
  customs?: CustomsDeclaration | null;
};

function dollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** EasyPost wants each customs line's total value and total weight, not per unit. */
export function easyPostCustomsInfo(customs: CustomsDeclaration) {
  return {
    contents_type: customs.contents,
    customs_certify: true,
    customs_signer: customs.signer,
    non_delivery_option: "return",
    restriction_type: "none",
    ...(customs.exportFiling ? { eel_pfc: customs.exportFiling } : {}),
    customs_items: customs.items.map((item) => ({
      description: item.description,
      quantity: item.qty,
      value: dollars(item.valueCents),
      weight: item.weightOz,
      hs_tariff_number: item.hsCode,
      origin_country: item.originCountry,
      code: item.sku,
      currency: customs.currency,
    })),
  };
}

/** ShipEngine wants each customs line's value per unit. */
export function shipEngineCustoms(customs: CustomsDeclaration) {
  return {
    contents: customs.contents,
    non_delivery: "return_to_sender",
    customs_items: customs.items.map((item) => ({
      description: item.description,
      quantity: item.qty,
      value: { currency: customs.currency.toLowerCase(), amount: dollars(item.unitValueCents) },
      harmonized_tariff_code: item.hsCode,
      country_of_origin: item.originCountry,
      sku: item.sku,
    })),
  };
}

export function easyPostAddress(address: LiveShipAddress) {
  return {
    name: address.name,
    street1: address.street1,
    street2: address.street2,
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: address.country,
  };
}

export function shipEngineAddress(address: LiveShipAddress) {
  return {
    name: address.name,
    address_line1: address.street1,
    address_line2: address.street2,
    city_locality: address.city,
    state_province: address.state,
    postal_code: address.zip,
    country_code: address.country,
  };
}

function shipEnginePackages(parcel: ParcelDims) {
  return [
    {
      weight: { value: parcel.weightOz, unit: "ounce" },
      dimensions: {
        unit: "inch",
        length: parcel.lengthIn,
        width: parcel.widthIn,
        height: parcel.heightIn,
      },
    },
  ];
}

/**
 * The EasyPost shipment for a parcel travelling `shipFrom` to `shipTo`. EasyPost wants a return
 * addressed like the outbound shipment it undoes (`to_address` is the customer) and swaps the two
 * itself when `is_return` is set, so a return body puts them back in outbound order.
 */
export function easyPostShipmentBody(input: Route & { returnLabel?: ReturnLabelRequest | null }) {
  const ret = input.returnLabel ?? null;
  return {
    shipment: {
      from_address: easyPostAddress(ret ? input.shipTo : input.shipFrom),
      to_address: easyPostAddress(ret ? input.shipFrom : input.shipTo),
      parcel: {
        length: input.parcel.lengthIn,
        width: input.parcel.widthIn,
        height: input.parcel.heightIn,
        weight: input.parcel.weightOz,
      },
      ...(input.customs ? { customs_info: easyPostCustomsInfo(input.customs) } : {}),
      ...(ret ? { is_return: true, reference: ret.rmaNumber } : {}),
    },
  };
}

export function shipEngineRateBody(input: Route) {
  return {
    rate_options: {},
    shipment: {
      validate_address: "no_validation",
      ship_from: shipEngineAddress(input.shipFrom),
      ship_to: shipEngineAddress(input.shipTo),
      packages: shipEnginePackages(input.parcel),
      ...(input.customs ? { customs: shipEngineCustoms(input.customs) } : {}),
    },
  };
}

/** ShipEngine takes a return in the direction it travels: `ship_from` is the customer, `ship_to` the building. */
export function shipEngineLabelBody(input: Route & { serviceId: string; returnLabel?: ReturnLabelRequest | null }) {
  const ret = input.returnLabel ?? null;
  return {
    ...(ret ? { is_return_label: true, rma_number: ret.rmaNumber } : {}),
    shipment: {
      service_code: shipEngineServiceCode(input.serviceId, input.shipFrom.country !== input.shipTo.country),
      validate_address: "no_validation",
      ship_from: shipEngineAddress(input.shipFrom),
      ship_to: shipEngineAddress(input.shipTo),
      packages: shipEnginePackages(input.parcel),
      ...(input.customs ? { customs: shipEngineCustoms(input.customs) } : {}),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function link(value: unknown): string | null {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

/** A bought EasyPost shipment's label: the PDF when EasyPost made one, else the image. */
export function easyPostLabelUrl(shipment: unknown): string | null {
  const label = asRecord(asRecord(shipment)?.postage_label);
  return link(label?.label_pdf_url) ?? link(label?.label_url);
}

/** A ShipEngine label's download: the PDF, else whatever `href` points at. */
export function shipEngineLabelUrl(payload: unknown): string | null {
  const download = asRecord(asRecord(payload)?.label_download);
  return link(download?.pdf) ?? link(download?.href);
}

/**
 * The customs form EasyPost generated with an international label: the commercial invoice or a CN form.
 * Postal labels often carry the CN22 on the label itself, and then there is none. Other forms, like QR codes, are not customs.
 */
export function easyPostCustomsFormUrl(shipment: unknown): string | null {
  const forms = asRecord(shipment)?.forms;
  if (!Array.isArray(forms)) return null;
  for (const form of forms) {
    const row = asRecord(form);
    const url = link(row?.form_url);
    if (url && /invoice|cn2[23]|customs/i.test(String(row?.form_type ?? ""))) return url;
  }
  return null;
}

export function shipEngineCustomsFormUrl(payload: unknown): string | null {
  const download = asRecord(asRecord(payload)?.form_download);
  return link(download?.href) ?? link(download?.pdf);
}
