import { maskSecret } from "./shopify";

export const CARRIER_PROVIDER_IDS = [
  "rackline",
  "ups",
  "fedex",
  "usps",
  "dhl",
  "easypost",
  "shipengine",
] as const;

export type CarrierProviderId = (typeof CARRIER_PROVIDER_IDS)[number];
export type CarrierKind = "platform" | "direct" | "aggregator";
export type CarrierCredentialField = "accountNumber" | "apiKey" | "apiSecret" | "meterNumber";

export type CarrierService = {
  id: string;
  company: string;
  service: string;
};

export type CarrierProvider = {
  id: CarrierProviderId;
  name: string;
  kind: CarrierKind;
  description: string;
  credentialFields: CarrierCredentialField[];
  trackingPrefix: string;
  services: CarrierService[];
};

const UPS_SERVICES: CarrierService[] = [
  { id: "ups_ground", company: "UPS", service: "Ground" },
  { id: "ups_2day", company: "UPS", service: "2nd Day Air" },
  { id: "ups_next_day", company: "UPS", service: "Next Day Air" },
];

const FEDEX_SERVICES: CarrierService[] = [
  { id: "fedex_ground", company: "FedEx", service: "Ground" },
  { id: "fedex_home", company: "FedEx", service: "Home Delivery" },
  { id: "fedex_2day", company: "FedEx", service: "2Day" },
];

const USPS_SERVICES: CarrierService[] = [
  { id: "usps_priority", company: "USPS", service: "Priority" },
  { id: "usps_ground_advantage", company: "USPS", service: "Ground Advantage" },
  { id: "usps_express", company: "USPS", service: "Express" },
];

const DHL_SERVICES: CarrierService[] = [{ id: "dhl_express", company: "DHL", service: "Express" }];

const RACKLINE_SERVICES: CarrierService[] = [{ id: "rackline_ground", company: "Rackline", service: "Ground" }];

export const AGGREGATOR_CHILD_SERVICES: CarrierService[] = [
  ...UPS_SERVICES,
  ...FEDEX_SERVICES,
  ...USPS_SERVICES,
  ...DHL_SERVICES,
];

export const CARRIER_PROVIDERS: CarrierProvider[] = [
  {
    id: "rackline",
    name: "Rackline",
    kind: "platform",
    description: "Always-on demo labels with RL- tracking. No carrier account required.",
    credentialFields: [],
    trackingPrefix: "RL-",
    services: RACKLINE_SERVICES,
  },
  {
    id: "ups",
    name: "UPS",
    kind: "direct",
    description: "Connect your UPS account. Live mode buys postage from UPS.",
    credentialFields: ["accountNumber", "apiKey", "apiSecret"],
    trackingPrefix: "1Z",
    services: UPS_SERVICES,
  },
  {
    id: "fedex",
    name: "FedEx",
    kind: "direct",
    description: "Connect your FedEx account. The meter number field holds the client secret. Live mode buys postage.",
    credentialFields: ["accountNumber", "apiKey", "meterNumber"],
    trackingPrefix: "FE-",
    services: FEDEX_SERVICES,
  },
  {
    id: "usps",
    name: "USPS",
    kind: "direct",
    description: "Connect your USPS account. Live mode buys postage with the API key as a bearer token.",
    credentialFields: ["accountNumber", "apiKey"],
    trackingPrefix: "9400",
    services: USPS_SERVICES,
  },
  {
    id: "dhl",
    name: "DHL",
    kind: "direct",
    description: "Connect your DHL Express account. Live mode buys postage with the API key.",
    credentialFields: ["accountNumber", "apiKey"],
    trackingPrefix: "DHL-",
    services: DHL_SERVICES,
  },
  {
    id: "easypost",
    name: "EasyPost",
    kind: "aggregator",
    description: "One API key unlocks UPS, FedEx, USPS, and DHL — the ShipHero-style path.",
    credentialFields: ["apiKey"],
    trackingPrefix: "EZ-",
    services: AGGREGATOR_CHILD_SERVICES,
  },
  {
    id: "shipengine",
    name: "ShipEngine",
    kind: "aggregator",
    description: "One API key shops rates across the carriers on your ShipEngine account.",
    credentialFields: ["apiKey"],
    trackingPrefix: "SE-",
    services: AGGREGATOR_CHILD_SERVICES,
  },
];

export const CARRIER_SERVICES: CarrierService[] = uniqueServices([
  ...RACKLINE_SERVICES,
  ...AGGREGATOR_CHILD_SERVICES,
]);

export type CarrierServiceId = (typeof CARRIER_SERVICES)[number]["id"];

export type CarrierCredentials = {
  accountNumber?: string | null;
  apiKey?: string | null;
  apiSecret?: string | null;
  meterNumber?: string | null;
};

export type CarrierConnectionLike = {
  id: string;
  provider: string;
  nickname: string;
  accountNumber?: string | null;
  mode: string;
  status?: string | null;
  apiKey?: string | null;
  apiSecret?: string | null;
  meterNumber?: string | null;
  enabledServicesJson: string;
  isDefault: boolean;
  lastTestedAt?: number | null;
  lastTestStatus?: string | null;
  lastTestError?: string | null;
  webhookSecret?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

export type EnabledCarrierService = CarrierService & {
  connectionId: string | null;
  provider: CarrierProviderId;
  isDefault: boolean;
};

export type CarrierRateQuote = EnabledCarrierService & {
  amountCents: number;
  currency: "USD";
  transitDays: number;
  liveRateId?: string | null;
};

export type LabelPurchase =
  | { ok: true; service: CarrierService; connectionId: string | null; provider: CarrierProviderId }
  | { ok: false; error: string };

export type VoidDecision = { ok: true } | { ok: false; error: string; code: "SHIPPED" | "NO_LABEL" | "CANCELLED" };

function uniqueServices(rows: CarrierService[]): CarrierService[] {
  const seen = new Set<string>();
  const out: CarrierService[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function isCarrierProvider(value: string): value is CarrierProviderId {
  return (CARRIER_PROVIDER_IDS as readonly string[]).includes(value);
}

export function resolveProvider(providerId?: string | null): CarrierProvider | null {
  if (!providerId) return null;
  return CARRIER_PROVIDERS.find((row) => row.id === providerId) ?? null;
}

export function isCarrierService(value: string): value is CarrierServiceId {
  return CARRIER_SERVICES.some((row) => row.id === value);
}

export function resolveService(serviceId?: string | null): CarrierService | null {
  if (!serviceId) return null;
  return CARRIER_SERVICES.find((row) => row.id === serviceId) ?? null;
}

export function providerForService(serviceId?: string | null): CarrierProvider {
  if (!serviceId) return CARRIER_PROVIDERS[0];
  const direct = CARRIER_PROVIDERS.find(
    (provider) => provider.kind !== "aggregator" && provider.services.some((row) => row.id === serviceId),
  );
  return direct ?? CARRIER_PROVIDERS[0];
}

export function trackingPrefixFor(serviceId?: string | null): string {
  return providerForService(serviceId).trackingPrefix;
}

export function trackingUrlForService(trackingNumber: string, serviceId?: string | null): string {
  const encoded = encodeURIComponent(trackingNumber);
  const provider = providerForService(serviceId);
  switch (provider.id) {
    case "ups":
      return `https://www.ups.com/track?tracknum=${encoded}`;
    case "usps":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
    case "dhl":
      return `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${encoded}`;
    default:
      return `https://track.rackline.dev/${encoded}`;
  }
}

export function parseEnabledServices(json: string | null | undefined, providerId: string): string[] {
  const provider = resolveProvider(providerId);
  const allowed = new Set((provider?.services ?? []).map((row) => row.id));
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(json || "[]");
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((value): value is string => typeof value === "string" && allowed.has(value));
}

export function defaultEnabledServices(providerId: string): string[] {
  return resolveProvider(providerId)?.services.map((row) => row.id) ?? [];
}

export function validateConnectionCredentials(
  providerId: string,
  input: CarrierCredentials & { mode?: string | null },
): { ok: true } | { ok: false; error: string } {
  const provider = resolveProvider(providerId);
  if (!provider) return { ok: false, error: "Unknown carrier provider" };
  const mode = input.mode === "live" ? "live" : "demo";
  if (mode !== "live") return { ok: true };
  for (const field of provider.credentialFields) {
    const value = input[field]?.trim();
    if (!value) {
      const label =
        field === "accountNumber"
          ? "Account number"
          : field === "apiKey"
            ? "API key"
            : field === "apiSecret"
              ? "API secret"
              : "Meter number";
      return { ok: false, error: `${label} is required for live ${provider.name}` };
    }
  }
  return { ok: true };
}

export function serializeCarrierConnection(row: CarrierConnectionLike) {
  const provider = resolveProvider(row.provider);
  const enabledServices = parseEnabledServices(row.enabledServicesJson, row.provider);
  return {
    id: row.id,
    provider: row.provider,
    name: provider?.name ?? row.provider,
    kind: provider?.kind ?? "direct",
    nickname: row.nickname,
    accountNumber: row.accountNumber ?? null,
    mode: row.mode === "live" ? "live" : "demo",
    status: row.status || "connected",
    isDefault: Boolean(row.isDefault),
    enabledServices,
    hasApiKey: Boolean(row.apiKey),
    hasApiSecret: Boolean(row.apiSecret),
    hasMeterNumber: Boolean(row.meterNumber),
    apiKeyHint: maskSecret(row.apiKey),
    apiSecretHint: maskSecret(row.apiSecret),
    meterHint: maskSecret(row.meterNumber),
    lastTestedAt: row.lastTestedAt ?? null,
    lastTestStatus: row.lastTestStatus ?? null,
    lastTestError: row.lastTestError ?? null,
    hasWebhookSecret: Boolean(row.webhookSecret),
    webhookSecretHint: maskSecret(row.webhookSecret),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

export function publicCarrierCatalog() {
  return CARRIER_PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    description: provider.description,
    credentialFields: provider.credentialFields,
    services: provider.services,
  }));
}

export function enabledServicesFromConnections(connections: CarrierConnectionLike[]): EnabledCarrierService[] {
  const out: EnabledCarrierService[] = [];
  const seen = new Set<string>();
  const ordered = [...connections].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  for (const connection of ordered) {
    if (!isCarrierProvider(connection.provider)) continue;
    for (const serviceId of parseEnabledServices(connection.enabledServicesJson, connection.provider)) {
      if (seen.has(serviceId)) continue;
      const service = resolveService(serviceId);
      if (!service) continue;
      seen.add(serviceId);
      out.push({
        ...service,
        connectionId: connection.id,
        provider: connection.provider,
        isDefault: Boolean(connection.isDefault) && out.length === 0,
      });
    }
  }
  if (!seen.has("rackline_ground")) {
    const rackline = resolveService("rackline_ground")!;
    const racklineConnection = connections.find((row) => row.provider === "rackline");
    out.unshift({
      ...rackline,
      connectionId: racklineConnection?.id ?? null,
      provider: "rackline",
      isDefault: out.length === 0,
    });
  }
  return out;
}

export function resolveLabelPurchase(input: {
  connections: CarrierConnectionLike[];
  serviceId?: string | null;
  connectionId?: string | null;
}): LabelPurchase {
  const serviceId = input.serviceId?.trim() || "rackline_ground";
  if (!isCarrierService(serviceId)) {
    return { ok: false, error: "Unknown carrier service" };
  }
  const service = resolveService(serviceId)!;
  if (input.connectionId) {
    const connection = input.connections.find((row) => row.id === input.connectionId);
    if (!connection) return { ok: false, error: "Carrier account not found" };
    const enabled = parseEnabledServices(connection.enabledServicesJson, connection.provider);
    if (!enabled.includes(serviceId)) {
      return { ok: false, error: "Carrier service is not enabled on a connected account" };
    }
    return {
      ok: true,
      service,
      connectionId: connection.id,
      provider: connection.provider as CarrierProviderId,
    };
  }
  const matches = enabledServicesFromConnections(input.connections).filter((row) => row.id === serviceId);
  const hit = matches[0];
  if (!hit) {
    return { ok: false, error: "Carrier service is not enabled on a connected account" };
  }
  return { ok: true, service, connectionId: hit.connectionId, provider: hit.provider };
}

export function quoteRates(input: {
  services: EnabledCarrierService[];
  shipFrom?: string | null;
  shipTo?: string | null;
}): CarrierRateQuote[] {
  const seed = `${input.shipFrom ?? ""}|${input.shipTo ?? ""}`;
  return input.services.map((service) => {
    const amountCents = 795 + (hashString(`${service.id}|${seed}`) % 1840);
    return {
      ...service,
      amountCents,
      currency: "USD" as const,
      transitDays: transitDaysFor(service.id),
    };
  });
}

export function canVoidLabel(input: {
  status: string;
  labelStatus?: string | null;
  shippedAt?: number | null;
}): VoidDecision {
  if (input.shippedAt) {
    return { ok: false, error: "Shipped cartons cannot void a label", code: "SHIPPED" };
  }
  if (input.status === "shipped") {
    return { ok: false, error: "Shipped orders cannot void a label", code: "SHIPPED" };
  }
  if (input.status === "cancelled") {
    return { ok: false, error: "Cancelled orders cannot void a label", code: "CANCELLED" };
  }
  if (input.labelStatus !== "purchased") {
    return { ok: false, error: "Buy a label before voiding", code: "NO_LABEL" };
  }
  return { ok: true };
}

export function demoCarrierSeeds(): {
  provider: CarrierProviderId;
  nickname: string;
  accountNumber: string | null;
  enabledServices: string[];
  isDefault: boolean;
}[] {
  return [
    {
      provider: "rackline",
      nickname: "Rackline Ground",
      accountNumber: null,
      enabledServices: ["rackline_ground"],
      isDefault: true,
    },
    {
      provider: "ups",
      nickname: "Northwind UPS",
      accountNumber: "A1B2C3",
      enabledServices: ["ups_ground"],
      isDefault: false,
    },
    {
      provider: "usps",
      nickname: "Northwind USPS",
      accountNumber: "123456789",
      enabledServices: ["usps_priority"],
      isDefault: false,
    },
  ];
}

export function testConnectionResult(input: {
  provider: string;
  mode: string;
  credentials: CarrierCredentials;
}): { ok: true; message: string } | { ok: false; error: string } {
  const mode = input.mode === "live" ? "live" : "demo";
  const valid = validateConnectionCredentials(input.provider, { ...input.credentials, mode });
  if (!valid.ok) return valid;
  const provider = resolveProvider(input.provider);
  if (mode === "live") {
    if (provider?.kind === "aggregator") {
      return {
        ok: true,
        message: "Credentials look complete. Test pings EasyPost or ShipEngine; Buy label purchases postage.",
      };
    }
    return {
      ok: true,
      message: "Credentials look complete. Test pings the carrier; Buy label purchases postage.",
    };
  }
  return { ok: true, message: "Demo connection is ready. Labels mint tracking without calling the carrier." };
}

function transitDaysFor(serviceId: string): number {
  if (serviceId.includes("next_day") || serviceId.endsWith("_express")) return 1;
  if (serviceId.includes("2day")) return 2;
  if (serviceId.includes("priority")) return 3;
  return 5;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
