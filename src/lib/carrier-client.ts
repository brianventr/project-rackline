import {
  CarrierLiveError,
  mapAggregatorService,
  pickMatchingLiveRate,
  shipEngineServiceCode,
  type LiveLabelResult,
  type LiveShipAddress,
  type ParcelDims,
} from "../domain/carrier-live";
import type { CarrierProviderId, CarrierRateQuote, EnabledCarrierService } from "../domain/carriers";

export class CarrierApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "CarrierApiError";
  }
}

type EasyPostRate = {
  id?: string;
  carrier?: string;
  service?: string;
  rate?: string;
  delivery_days?: number | null;
};

type EasyPostShipment = {
  id?: string;
  rates?: EasyPostRate[];
  selected_rate?: EasyPostRate | null;
  tracking_code?: string | null;
  tracker?: { public_url?: string | null } | null;
  postage_label?: { label_url?: string | null } | null;
  messages?: Array<{ message?: string }>;
};

type ShipEngineRate = {
  rate_id?: string;
  carrier_code?: string;
  service_code?: string;
  shipping_amount?: { amount?: number };
  delivery_days?: number | null;
};

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

async function easyPost<T>(apiKey: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.easypost.com/v2${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:`)}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await readJson(res);
  if (!res.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? JSON.stringify((payload as { error?: unknown }).error)
        : `EasyPost HTTP ${res.status}`;
    throw new CarrierApiError(message, res.status, payload);
  }
  return payload as T;
}

async function shipEngine<T>(apiKey: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.shipengine.com${path}`, {
    method,
    headers: {
      "API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await readJson(res);
  if (!res.ok) {
    const message =
      payload && typeof payload === "object" && "errors" in payload
        ? JSON.stringify((payload as { errors?: unknown }).errors)
        : `ShipEngine HTTP ${res.status}`;
    throw new CarrierApiError(message, res.status, payload);
  }
  return payload as T;
}

function easyPostAddress(address: LiveShipAddress) {
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

function shipEngineAddress(address: LiveShipAddress) {
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

export async function pingAggregator(provider: CarrierProviderId, apiKey: string): Promise<{ ok: true; message: string }> {
  if (provider === "easypost") {
    await easyPost(apiKey, "/carrier_accounts");
    return { ok: true, message: "EasyPost account reached. Live rates and postage are enabled." };
  }
  if (provider === "shipengine") {
    await shipEngine(apiKey, "GET", "/v1/carriers");
    return { ok: true, message: "ShipEngine account reached. Live rates and postage are enabled." };
  }
  throw new CarrierLiveError("Live postage is only implemented for EasyPost and ShipEngine.");
}

function mapEasyPostRates(
  rates: EasyPostRate[],
  services: EnabledCarrierService[],
): Array<CarrierRateQuote & { liveRateId: string }> {
  const byId = new Map(services.map((row) => [row.id, row]));
  const out: Array<CarrierRateQuote & { liveRateId: string }> = [];
  for (const rate of rates) {
    if (!rate.id || rate.rate == null) continue;
    const serviceId = mapAggregatorService(rate.carrier || "", rate.service || "");
    const service = serviceId ? byId.get(serviceId) : null;
    if (!service) continue;
    const amountCents = Math.round(Number(rate.rate) * 100);
    if (!Number.isFinite(amountCents)) continue;
    out.push({
      ...service,
      amountCents,
      currency: "USD",
      transitDays: rate.delivery_days && rate.delivery_days > 0 ? rate.delivery_days : 5,
      liveRateId: rate.id,
    });
  }
  return out;
}

export async function shopEasyPostRates(input: {
  apiKey: string;
  services: EnabledCarrierService[];
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
}): Promise<{ rates: CarrierRateQuote[]; shipmentId: string | null; raw: unknown }> {
  const shipment = await easyPost<EasyPostShipment>(input.apiKey, "/shipments", {
    shipment: {
      from_address: easyPostAddress(input.shipFrom),
      to_address: easyPostAddress(input.shipTo),
      parcel: {
        length: input.parcel.lengthIn,
        width: input.parcel.widthIn,
        height: input.parcel.heightIn,
        weight: input.parcel.weightOz,
      },
    },
  });
  return {
    rates: mapEasyPostRates(shipment.rates ?? [], input.services),
    shipmentId: shipment.id ?? null,
    raw: shipment,
  };
}

export async function buyEasyPostLabel(input: {
  apiKey: string;
  services: EnabledCarrierService[];
  serviceId: string;
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
}): Promise<LiveLabelResult> {
  const created = await shopEasyPostRates(input);
  const mapped = created.rates.map((row) => ({
    serviceId: row.id,
    amountCents: row.amountCents,
    liveRateId: row.liveRateId ?? null,
  }));
  const match = pickMatchingLiveRate(mapped, input.serviceId);
  if (!created.shipmentId || !match?.liveRateId) {
    throw new CarrierLiveError(`EasyPost did not return a ${input.serviceId} rate for this parcel.`, "NO_RATE");
  }
  const bought = await easyPost<EasyPostShipment>(input.apiKey, `/shipments/${created.shipmentId}/buy`, {
    rate: { id: match.liveRateId },
  });
  const tracking = bought.tracking_code?.trim();
  if (!tracking) {
    throw new CarrierLiveError("EasyPost bought a label without a tracking number.");
  }
  return {
    trackingNumber: tracking,
    trackingUrl: bought.tracker?.public_url ?? null,
    shipmentId: bought.id ?? created.shipmentId,
    labelId: bought.postage_label ? bought.id ?? created.shipmentId : created.shipmentId,
    postageCents: match.amountCents,
    provider: "easypost",
  };
}

export async function voidEasyPostShipment(apiKey: string, shipmentId: string): Promise<void> {
  await easyPost(apiKey, `/shipments/${shipmentId}/refund`);
}

export async function shopShipEngineRates(input: {
  apiKey: string;
  services: EnabledCarrierService[];
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
}): Promise<{ rates: CarrierRateQuote[]; raw: unknown }> {
  const payload = await shipEngine<{ rate_response?: { rates?: ShipEngineRate[] } }>(input.apiKey, "POST", "/v1/rates", {
    rate_options: {},
    shipment: {
      validate_address: "no_validation",
      ship_from: shipEngineAddress(input.shipFrom),
      ship_to: shipEngineAddress(input.shipTo),
      packages: [
        {
          weight: { value: input.parcel.weightOz, unit: "ounce" },
          dimensions: {
            unit: "inch",
            length: input.parcel.lengthIn,
            width: input.parcel.widthIn,
            height: input.parcel.heightIn,
          },
        },
      ],
    },
  });
  const byId = new Map(input.services.map((row) => [row.id, row]));
  const rates: CarrierRateQuote[] = [];
  for (const rate of payload.rate_response?.rates ?? []) {
    const serviceId = mapAggregatorService(rate.carrier_code || "", rate.service_code || "");
    const service = serviceId ? byId.get(serviceId) : null;
    if (!service || rate.rate_id == null || rate.shipping_amount?.amount == null) continue;
    rates.push({
      ...service,
      amountCents: Math.round(Number(rate.shipping_amount.amount) * 100),
      currency: "USD",
      transitDays: rate.delivery_days && rate.delivery_days > 0 ? rate.delivery_days : 5,
      liveRateId: rate.rate_id,
    });
  }
  return { rates, raw: payload };
}

export async function buyShipEngineLabel(input: {
  apiKey: string;
  serviceId: string;
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
}): Promise<LiveLabelResult> {
  const payload = await shipEngine<{
    label_id?: string;
    shipment_id?: string;
    tracking_number?: string;
    tracking_url?: string;
    shipment_cost?: { amount?: number };
  }>(input.apiKey, "POST", "/v1/labels", {
    shipment: {
      service_code: shipEngineServiceCode(input.serviceId),
      validate_address: "no_validation",
      ship_from: shipEngineAddress(input.shipFrom),
      ship_to: shipEngineAddress(input.shipTo),
      packages: [
        {
          weight: { value: input.parcel.weightOz, unit: "ounce" },
          dimensions: {
            unit: "inch",
            length: input.parcel.lengthIn,
            width: input.parcel.widthIn,
            height: input.parcel.heightIn,
          },
        },
      ],
    },
  });
  const tracking = payload.tracking_number?.trim();
  if (!tracking) {
    throw new CarrierLiveError("ShipEngine bought a label without a tracking number.");
  }
  return {
    trackingNumber: tracking,
    trackingUrl: payload.tracking_url ?? null,
    shipmentId: payload.shipment_id ?? null,
    labelId: payload.label_id ?? null,
    postageCents: payload.shipment_cost?.amount != null ? Math.round(Number(payload.shipment_cost.amount) * 100) : null,
    provider: "shipengine",
  };
}

export async function voidShipEngineLabel(apiKey: string, labelId: string): Promise<void> {
  await shipEngine(apiKey, "PUT", `/v1/labels/${labelId}/void`);
}

export async function shopAggregatorRates(input: {
  provider: CarrierProviderId;
  apiKey: string;
  services: EnabledCarrierService[];
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
}): Promise<{ rates: CarrierRateQuote[]; shipmentId?: string | null; raw: unknown }> {
  if (input.provider === "easypost") return shopEasyPostRates(input);
  if (input.provider === "shipengine") return shopShipEngineRates(input);
  throw new CarrierLiveError("Live postage is only implemented for EasyPost and ShipEngine.");
}

export async function buyAggregatorLabel(input: {
  provider: CarrierProviderId;
  apiKey: string;
  services: EnabledCarrierService[];
  serviceId: string;
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
}): Promise<LiveLabelResult> {
  if (input.provider === "easypost") return buyEasyPostLabel(input);
  if (input.provider === "shipengine") return buyShipEngineLabel(input);
  throw new CarrierLiveError("Live postage is only implemented for EasyPost and ShipEngine.");
}

export async function voidAggregatorLabel(input: {
  provider: CarrierProviderId;
  apiKey: string;
  shipmentId?: string | null;
  labelId?: string | null;
}): Promise<void> {
  if (input.provider === "easypost") {
    if (!input.shipmentId) throw new CarrierLiveError("EasyPost void needs a shipment id.");
    await voidEasyPostShipment(input.apiKey, input.shipmentId);
    return;
  }
  if (input.provider === "shipengine") {
    if (!input.labelId) throw new CarrierLiveError("ShipEngine void needs a label id.");
    await voidShipEngineLabel(input.apiKey, input.labelId);
    return;
  }
  throw new CarrierLiveError("Live postage is only implemented for EasyPost and ShipEngine.");
}

export function asCarrierLiveError(err: unknown): CarrierLiveError {
  if (err instanceof CarrierLiveError) return err;
  if (err instanceof CarrierApiError) return new CarrierLiveError(err.message);
  return new CarrierLiveError(err instanceof Error ? err.message : "Carrier request failed");
}
