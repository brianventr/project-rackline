import {
  CARRIER_SERVICES,
  isCarrierService,
  resolveService,
  trackingPrefixFor,
  trackingUrlForService,
  type CarrierServiceId,
} from "./carriers";

export { CARRIER_SERVICES, isCarrierService };
export type { CarrierServiceId };

export type ShippingLabel = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  shipToAddress: string;
  shipFromAddress?: string | null;
  carrierCompany: string;
  carrierService: string;
  carrierServiceId: string;
  trackingNumber: string;
  trackingUrl: string;
  connectionId?: string | null;
  labelStatus?: string | null;
};

export function resolveCarrier(serviceId?: string | null) {
  return resolveService(serviceId) ?? CARRIER_SERVICES[0];
}

export function generateTrackingNumber(serviceId?: string | null, random?: () => string): string {
  const mint = random ?? (() => crypto.randomUUID());
  const token = mint().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `${trackingPrefixFor(serviceId)}${token}`;
}

export function trackingUrlFor(trackingNumber: string, serviceId?: string | null): string {
  if (serviceId) return trackingUrlForService(trackingNumber, serviceId);
  if (trackingNumber.startsWith("1Z")) return trackingUrlForService(trackingNumber, "ups_ground");
  if (trackingNumber.startsWith("9400")) return trackingUrlForService(trackingNumber, "usps_priority");
  if (trackingNumber.startsWith("FE-")) return trackingUrlForService(trackingNumber, "fedex_ground");
  if (trackingNumber.startsWith("DHL-")) return trackingUrlForService(trackingNumber, "dhl_express");
  return trackingUrlForService(trackingNumber, "rackline_ground");
}

export function buildShippingLabel(input: {
  id: string;
  number: string;
  customerName: string;
  shipToAddress?: string | null;
  shipFromAddress?: string | null;
  trackingNumber?: string | null;
  trackingCompany?: string | null;
  trackingUrl?: string | null;
  carrierService?: string | null;
  carrierConnectionId?: string | null;
  labelStatus?: string | null;
}): ShippingLabel {
  const carrier = resolveCarrier(input.carrierService);
  const trackingNumber = input.trackingNumber?.trim() || generateTrackingNumber(carrier.id);
  return {
    orderId: input.id,
    orderNumber: input.number,
    customerName: input.customerName,
    shipToAddress: input.shipToAddress?.trim() || input.customerName,
    shipFromAddress: input.shipFromAddress?.trim() || null,
    carrierCompany: input.trackingCompany?.trim() || carrier.company,
    carrierService: carrier.service,
    carrierServiceId: carrier.id,
    trackingNumber,
    trackingUrl: input.trackingUrl?.trim() || trackingUrlFor(trackingNumber, carrier.id),
    connectionId: input.carrierConnectionId ?? null,
    labelStatus: input.labelStatus ?? null,
  };
}
