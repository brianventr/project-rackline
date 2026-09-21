import {
  CarrierLiveError,
  isLiveAggregator,
  isLiveDirect,
  type LiveLabelResult,
  type LiveShipAddress,
  type ParcelDims,
} from "../domain/carrier-live";
import type { CarrierProviderId, CarrierRateQuote, EnabledCarrierService } from "../domain/carriers";
import { isDirectProvider } from "../domain/direct-carrier";
import { buyAggregatorLabel, shopAggregatorRates, voidAggregatorLabel } from "./carrier-client";
import { buyDirectLabel, shopDirectRates, voidDirectLabel } from "./direct-carrier";

export type PostageConnection = {
  provider: string;
  mode: string;
  apiKey?: string | null;
  apiSecret?: string | null;
  meterNumber?: string | null;
  accountNumber?: string | null;
};

export async function buyLivePostage(input: {
  connection: PostageConnection;
  services: EnabledCarrierService[];
  serviceId: string;
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
}): Promise<LiveLabelResult> {
  const { connection } = input;
  if (!connection.apiKey) throw new CarrierLiveError("Live postage needs an API key");
  if (isLiveAggregator(connection.provider, connection.mode)) {
    return buyAggregatorLabel({
      provider: connection.provider as CarrierProviderId,
      apiKey: connection.apiKey,
      services: input.services,
      serviceId: input.serviceId,
      shipFrom: input.shipFrom,
      shipTo: input.shipTo,
      parcel: input.parcel,
    });
  }
  if (isLiveDirect(connection.provider, connection.mode) && isDirectProvider(connection.provider)) {
    return buyDirectLabel({
      provider: connection.provider,
      accountNumber: connection.accountNumber || "",
      apiKey: connection.apiKey,
      apiSecret: connection.apiSecret,
      meterNumber: connection.meterNumber,
      serviceId: input.serviceId,
      shipFrom: input.shipFrom,
      shipTo: input.shipTo,
      parcel: input.parcel,
    });
  }
  throw new CarrierLiveError("Live postage is not enabled for this carrier.");
}

export async function shopLiveRates(input: {
  connection: PostageConnection;
  services: EnabledCarrierService[];
  shipFrom: LiveShipAddress;
  shipTo: LiveShipAddress;
  parcel: ParcelDims;
}): Promise<{ rates: CarrierRateQuote[]; shipmentId?: string | null; raw: unknown }> {
  const { connection } = input;
  if (!connection.apiKey) throw new CarrierLiveError("Live postage needs an API key");
  if (isLiveAggregator(connection.provider, connection.mode)) {
    return shopAggregatorRates({
      provider: connection.provider as CarrierProviderId,
      apiKey: connection.apiKey,
      services: input.services,
      shipFrom: input.shipFrom,
      shipTo: input.shipTo,
      parcel: input.parcel,
    });
  }
  if (isLiveDirect(connection.provider, connection.mode) && isDirectProvider(connection.provider)) {
    return shopDirectRates({
      provider: connection.provider,
      accountNumber: connection.accountNumber || "",
      apiKey: connection.apiKey,
      apiSecret: connection.apiSecret,
      meterNumber: connection.meterNumber,
      services: input.services,
      shipFrom: input.shipFrom,
      shipTo: input.shipTo,
      parcel: input.parcel,
    });
  }
  throw new CarrierLiveError("Live postage is not enabled for this carrier.");
}

export async function voidLivePostage(input: {
  connection: PostageConnection;
  shipmentId?: string | null;
  labelId?: string | null;
  trackingNumber?: string | null;
}): Promise<void> {
  const { connection } = input;
  if (!connection.apiKey) throw new CarrierLiveError("Live void needs an API key");
  if (isLiveAggregator(connection.provider, connection.mode)) {
    await voidAggregatorLabel({
      provider: connection.provider as CarrierProviderId,
      apiKey: connection.apiKey,
      shipmentId: input.shipmentId,
      labelId: input.labelId,
    });
    return;
  }
  if (isLiveDirect(connection.provider, connection.mode) && isDirectProvider(connection.provider)) {
    await voidDirectLabel({
      provider: connection.provider,
      accountNumber: connection.accountNumber || "",
      apiKey: connection.apiKey,
      apiSecret: connection.apiSecret,
      meterNumber: connection.meterNumber,
      shipmentId: input.shipmentId,
      labelId: input.labelId,
      trackingNumber: input.trackingNumber,
    });
    return;
  }
  throw new CarrierLiveError("Live postage is not enabled for this carrier.");
}
