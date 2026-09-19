export const CARRIER_SERVICES = [
  { id: "rackline_ground", company: "Rackline", service: "Ground" },
  { id: "ups_ground", company: "UPS", service: "Ground" },
  { id: "usps_priority", company: "USPS", service: "Priority" },
] as const;

export type CarrierServiceId = (typeof CARRIER_SERVICES)[number]["id"];

export type ShippingLabel = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  shipToAddress: string;
  carrierCompany: string;
  carrierService: string;
  carrierServiceId: string;
  trackingNumber: string;
  trackingUrl: string;
};

export function isCarrierService(value: string): value is CarrierServiceId {
  return CARRIER_SERVICES.some((row) => row.id === value);
}

export function resolveCarrier(serviceId?: string | null) {
  return CARRIER_SERVICES.find((row) => row.id === serviceId) ?? CARRIER_SERVICES[0];
}

export function generateTrackingNumber(random?: () => string): string {
  const mint = random ?? (() => crypto.randomUUID());
  const token = mint().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `RL-${token}`;
}

export function trackingUrlFor(trackingNumber: string): string {
  return `https://track.rackline.dev/${encodeURIComponent(trackingNumber)}`;
}

export function buildShippingLabel(input: {
  id: string;
  number: string;
  customerName: string;
  shipToAddress?: string | null;
  trackingNumber?: string | null;
  trackingCompany?: string | null;
  trackingUrl?: string | null;
  carrierService?: string | null;
}): ShippingLabel {
  const carrier = resolveCarrier(input.carrierService);
  const trackingNumber = input.trackingNumber?.trim() || generateTrackingNumber();
  return {
    orderId: input.id,
    orderNumber: input.number,
    customerName: input.customerName,
    shipToAddress: input.shipToAddress?.trim() || input.customerName,
    carrierCompany: input.trackingCompany?.trim() || carrier.company,
    carrierService: carrier.service,
    carrierServiceId: carrier.id,
    trackingNumber,
    trackingUrl: input.trackingUrl?.trim() || trackingUrlFor(trackingNumber),
  };
}
