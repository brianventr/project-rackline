import {
  CarrierLiveError,
  toLiveRateQuote,
  type LiveLabelResult,
  type LiveShipAddress,
  type ParcelDims,
} from "../domain/carrier-live";
import type { CarrierRateQuote, EnabledCarrierService } from "../domain/carriers";
import {
  dhlRateQuery,
  dhlShipmentBody,
  directClientSecret,
  directServiceCode,
  fedexRateBody,
  fedexShipBody,
  isDirectProvider,
  parseDhlLabel,
  parseDhlRates,
  parseFedexLabel,
  parseFedexRates,
  parseUpsLabel,
  parseUpsRates,
  parseUspsLabel,
  parseUspsRate,
  upsRateBody,
  upsShipBody,
  uspsLabelBody,
  uspsRateBody,
  type DirectProvider,
} from "../domain/direct-carrier";
import { CarrierApiError } from "./carrier-client";

const UPS_ORIGIN = "https://onlinetools.ups.com";
const FEDEX_ORIGIN = "https://apis.fedex.com";
const USPS_ORIGIN = "https://apis.usps.com";
const DHL_ORIGIN = "https://express.api.dhl.com/mydhlapi";

export type DirectCreds = {
  provider: DirectProvider;
  accountNumber: string;
  apiKey: string;
  apiSecret?: string | null;
  meterNumber?: string | null;
};

type ShipInput = DirectCreds & {
  serviceId: string;
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
};

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const row = payload as Record<string, unknown>;
  if (typeof row.message === "string" && row.message.trim()) return row.message;
  if (typeof row.error === "string" && row.error.trim()) return row.error;
  const response = row.response && typeof row.response === "object" ? (row.response as Record<string, unknown>) : null;
  const errors = response?.errors ?? row.errors;
  if (Array.isArray(errors) && errors[0] && typeof errors[0] === "object") {
    const message = (errors[0] as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 500) };
  }
}

async function carrierJson(res: Response, label: string): Promise<unknown> {
  const payload = await readBody(res);
  if (!res.ok) throw new CarrierApiError(errorMessage(payload, `${label} HTTP ${res.status}`), res.status, payload);
  return payload;
}

function requireCreds(input: DirectCreds): { accountNumber: string; apiKey: string; secret: string | null } {
  const accountNumber = input.accountNumber.trim();
  const apiKey = input.apiKey.trim();
  if (!accountNumber) throw new CarrierLiveError("Live postage needs an account number");
  if (!apiKey) throw new CarrierLiveError("Live postage needs an API key");
  const secret = directClientSecret({
    provider: input.provider,
    apiSecret: input.apiSecret,
    meterNumber: input.meterNumber,
  });
  if ((input.provider === "ups" || input.provider === "fedex") && !secret) {
    throw new CarrierLiveError(
      input.provider === "fedex"
        ? "FedEx live postage needs the client secret in the meter number field"
        : "UPS live postage needs an API secret",
    );
  }
  return { accountNumber, apiKey, secret };
}

async function bearerToken(url: string, headers: HeadersInit, body: string, label: string): Promise<string> {
  const res = await fetch(url, { method: "POST", headers, body });
  const payload = await carrierJson(res, label);
  const token =
    payload && typeof payload === "object" && "access_token" in payload
      ? String((payload as { access_token?: unknown }).access_token ?? "")
      : "";
  if (!token.trim()) throw new CarrierApiError(`${label} token response had no access_token`);
  return token.trim();
}

async function upsToken(apiKey: string, secret: string): Promise<string> {
  return bearerToken(
    `${UPS_ORIGIN}/security/v1/oauth/token`,
    {
      Authorization: `Basic ${btoa(`${apiKey}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    "grant_type=client_credentials",
    "UPS",
  );
}

async function fedexToken(apiKey: string, secret: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: apiKey,
    client_secret: secret,
  });
  return bearerToken(
    `${FEDEX_ORIGIN}/oauth/token`,
    { "Content-Type": "application/x-www-form-urlencoded" },
    body.toString(),
    "FedEx",
  );
}

function upsHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    transId: crypto.randomUUID(),
    transactionSrc: "rackline",
  };
}

function dhlAuth(apiKey: string): string {
  return `Basic ${btoa(`${apiKey}:`)}`;
}

function labelResult(provider: DirectProvider, parsed: NonNullable<ReturnType<typeof parseUpsLabel>>): LiveLabelResult {
  return {
    trackingNumber: parsed.trackingNumber,
    trackingUrl: parsed.trackingUrl,
    shipmentId: parsed.shipmentId,
    labelId: parsed.labelId,
    postageCents: parsed.postageCents,
    provider,
  };
}

function quotesFromParsed(
  parsed: { serviceId: string; amountCents: number; transitDays: number | null }[],
  services: EnabledCarrierService[],
): CarrierRateQuote[] {
  const byId = new Map(services.map((row) => [row.id, row]));
  const rates: CarrierRateQuote[] = [];
  for (const row of parsed) {
    const service = byId.get(row.serviceId);
    if (!service) continue;
    rates.push(toLiveRateQuote(service, { amountCents: row.amountCents, transitDays: row.transitDays }));
  }
  return rates;
}

export async function pingDirect(input: DirectCreds): Promise<{ ok: true; message: string }> {
  if (!isDirectProvider(input.provider)) throw new CarrierLiveError("Live postage is not enabled for this carrier.");
  const creds = requireCreds(input);
  if (input.provider === "ups") {
    await upsToken(creds.apiKey, creds.secret!);
    return { ok: true, message: "UPS account reached. Live rates and postage are enabled." };
  }
  if (input.provider === "fedex") {
    await fedexToken(creds.apiKey, creds.secret!);
    return { ok: true, message: "FedEx account reached. Live rates and postage are enabled." };
  }
  if (input.provider === "usps") {
    const res = await fetch(`${USPS_ORIGIN}/prices/v3/total-rates/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (res.status === 401 || res.status === 403) throw new CarrierApiError("USPS rejected the API key", res.status);
    return { ok: true, message: "USPS API answered. Live rates and postage are enabled." };
  }
  const res = await fetch(`${DHL_ORIGIN}/rates?accountNumber=${encodeURIComponent(creds.accountNumber)}`, {
    headers: { Authorization: dhlAuth(creds.apiKey) },
  });
  if (res.status === 401 || res.status === 403) throw new CarrierApiError("DHL rejected the API key", res.status);
  return { ok: true, message: "DHL API answered. Live rates and postage are enabled." };
}

export async function shopDirectRates(input: Omit<ShipInput, "serviceId"> & { services: EnabledCarrierService[] }): Promise<{
  rates: CarrierRateQuote[];
  raw: unknown;
}> {
  const creds = requireCreds(input);
  const ship = {
    accountNumber: creds.accountNumber,
    shipFrom: input.shipFrom,
    shipTo: input.shipTo,
    parcel: input.parcel,
  };
  if (input.provider === "ups") {
    const token = await upsToken(creds.apiKey, creds.secret!);
    const res = await fetch(`${UPS_ORIGIN}/api/rating/v2409/Rate`, {
      method: "POST",
      headers: upsHeaders(token),
      body: JSON.stringify(upsRateBody(ship)),
    });
    const payload = await carrierJson(res, "UPS");
    return { rates: quotesFromParsed(parseUpsRates(payload), input.services), raw: payload };
  }
  if (input.provider === "fedex") {
    const token = await fedexToken(creds.apiKey, creds.secret!);
    const res = await fetch(`${FEDEX_ORIGIN}/rate/v1/rates/quotes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(fedexRateBody(ship)),
    });
    const payload = await carrierJson(res, "FedEx");
    return { rates: quotesFromParsed(parseFedexRates(payload), input.services), raw: payload };
  }
  if (input.provider === "usps") {
    const rates: CarrierRateQuote[] = [];
    const raw: unknown[] = [];
    for (const service of input.services) {
      try {
        directServiceCode("usps", service.id);
      } catch {
        continue;
      }
      const res = await fetch(`${USPS_ORIGIN}/prices/v3/total-rates/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(uspsRateBody({ ...ship, serviceId: service.id })),
      });
      const payload = await carrierJson(res, "USPS");
      raw.push(payload);
      rates.push(...quotesFromParsed(parseUspsRate(payload, service.id), [service]));
    }
    return { rates, raw };
  }
  const res = await fetch(`${DHL_ORIGIN}/rates?${dhlRateQuery(ship)}`, {
    headers: { Authorization: dhlAuth(creds.apiKey) },
  });
  const payload = await carrierJson(res, "DHL");
  return { rates: quotesFromParsed(parseDhlRates(payload), input.services), raw: payload };
}

export async function buyDirectLabel(input: ShipInput): Promise<LiveLabelResult> {
  const creds = requireCreds(input);
  const ship = {
    accountNumber: creds.accountNumber,
    serviceId: input.serviceId,
    shipFrom: input.shipFrom,
    shipTo: input.shipTo,
    parcel: input.parcel,
  };
  if (input.provider === "ups") {
    const token = await upsToken(creds.apiKey, creds.secret!);
    const res = await fetch(`${UPS_ORIGIN}/api/shipments/v2409/ship`, {
      method: "POST",
      headers: upsHeaders(token),
      body: JSON.stringify(upsShipBody(ship)),
    });
    const payload = await carrierJson(res, "UPS");
    const parsed = parseUpsLabel(payload);
    if (!parsed) throw new CarrierLiveError("UPS bought a label without a tracking number.");
    return labelResult("ups", parsed);
  }
  if (input.provider === "fedex") {
    const token = await fedexToken(creds.apiKey, creds.secret!);
    const res = await fetch(`${FEDEX_ORIGIN}/ship/v1/shipments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(fedexShipBody(ship)),
    });
    const payload = await carrierJson(res, "FedEx");
    const parsed = parseFedexLabel(payload);
    if (!parsed) throw new CarrierLiveError("FedEx bought a label without a tracking number.");
    return labelResult("fedex", parsed);
  }
  if (input.provider === "usps") {
    const res = await fetch(`${USPS_ORIGIN}/labels/v3/label`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(uspsLabelBody(ship)),
    });
    const payload = await carrierJson(res, "USPS");
    const parsed = parseUspsLabel(payload);
    if (!parsed) throw new CarrierLiveError("USPS bought a label without a tracking number.");
    return labelResult("usps", parsed);
  }
  const res = await fetch(`${DHL_ORIGIN}/shipments`, {
    method: "POST",
    headers: { Authorization: dhlAuth(creds.apiKey), "Content-Type": "application/json" },
    body: JSON.stringify(dhlShipmentBody(ship)),
  });
  const payload = await carrierJson(res, "DHL");
  const parsed = parseDhlLabel(payload);
  if (!parsed) throw new CarrierLiveError("DHL bought a label without a tracking number.");
  return labelResult("dhl", parsed);
}

export async function voidDirectLabel(input: DirectCreds & {
  shipmentId?: string | null;
  labelId?: string | null;
  trackingNumber?: string | null;
}): Promise<void> {
  const creds = requireCreds(input);
  const id = input.shipmentId?.trim() || input.labelId?.trim() || input.trackingNumber?.trim() || "";
  if (!id) throw new CarrierLiveError("Live void needs a shipment or tracking id.");
  if (input.provider === "ups") {
    const token = await upsToken(creds.apiKey, creds.secret!);
    const res = await fetch(`${UPS_ORIGIN}/api/shipments/v2409/void/cancel/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: upsHeaders(token),
    });
    await carrierJson(res, "UPS");
    return;
  }
  if (input.provider === "fedex") {
    const token = await fedexToken(creds.apiKey, creds.secret!);
    const res = await fetch(`${FEDEX_ORIGIN}/ship/v1/shipments/cancel`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        accountNumber: { value: creds.accountNumber },
        trackingNumber: input.trackingNumber?.trim() || id,
        senderCountryCode: "US",
        deletionControl: "DELETE_ALL_PACKAGES",
      }),
    });
    await carrierJson(res, "FedEx");
    return;
  }
  if (input.provider === "usps") {
    const tracking = input.trackingNumber?.trim() || id;
    const res = await fetch(`${USPS_ORIGIN}/labels/v3/label/${encodeURIComponent(tracking)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${creds.apiKey}` },
    });
    await carrierJson(res, "USPS");
    return;
  }
  const res = await fetch(`${DHL_ORIGIN}/shipments/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: dhlAuth(creds.apiKey) },
  });
  await carrierJson(res, "DHL");
}
