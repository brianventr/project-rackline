import { shipEngineServiceCode, type LiveShipAddress, type ParcelDims, type ReturnLabelRequest } from "./carrier-live";

type Route = {
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
};

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
    },
  };
}

/** ShipEngine takes a return in the direction it travels: `ship_from` is the customer, `ship_to` the building. */
export function shipEngineLabelBody(input: Route & { serviceId: string; returnLabel?: ReturnLabelRequest | null }) {
  const ret = input.returnLabel ?? null;
  return {
    ...(ret ? { is_return_label: true, rma_number: ret.rmaNumber } : {}),
    shipment: {
      service_code: shipEngineServiceCode(input.serviceId),
      validate_address: "no_validation",
      ship_from: shipEngineAddress(input.shipFrom),
      ship_to: shipEngineAddress(input.shipTo),
      packages: shipEnginePackages(input.parcel),
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
