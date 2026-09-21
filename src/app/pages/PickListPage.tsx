import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  api,
  type Client,
  type FloorJob,
  type Item,
  type Location,
  type Order,
  type Wave,
  type Zone,
} from "../api";
import { ErrorBanner } from "../components/ui";
import { OrderPickListSheet, WavePickListSheet } from "../components/PickListDocument";
import { useSession } from "../session";
import {
  buildOrderPickList,
  buildWavePickList,
  type OrderPickListInput,
  type PickListLocation,
  type PickListLot,
} from "@/domain/pick-list";

function orderToInput(order: Order): OrderPickListInput {
  return {
    number: order.number,
    customerName: order.customerName,
    status: order.status,
    source: order.source,
    shopifyOrderName: order.shopifyOrderName,
    shipToCity: order.shipToCity,
    shipToRegion: order.shipToRegion,
    shipToCountry: order.shipToCountry,
    shipToAddress: order.shipToAddress,
    lines: (order.lines ?? []).map((line) => ({
      lineId: line.id,
      orderId: order.id,
      orderNumber: order.number,
      sku: line.sku,
      itemName: line.itemName,
      barcode: line.barcode,
      qtyOrdered: line.qty,
      qtyPicked: line.qtyPicked ?? 0,
      remaining: line.remaining ?? Math.max(0, line.qty - (line.qtyPicked ?? 0)),
      suggestedLocation: line.suggestedLocation,
      allocations: line.allocations,
      trackLot: line.trackLot,
      trackSerial: line.trackSerial,
      catchWeight: line.catchWeight,
      trackExpiry: line.trackExpiry,
      stockUom: line.stockUom,
      altUom: line.altUom,
      altPerStock: line.altPerStock,
    })),
  };
}

async function loadLocationsWithZones(): Promise<PickListLocation[]> {
  const [locations, zones] = await Promise.all([
    api<Location[]>("/api/locations"),
    api<Zone[]>("/api/zones").catch(() => [] as Zone[]),
  ]);
  const zoneById = new Map(zones.map((zone) => [zone.id, zone.name || zone.code]));
  return locations.map((location) => ({
    id: location.id,
    code: location.code,
    barcode: location.barcode,
    aisle: location.aisle,
    rack: location.rack,
    bay: location.bay,
    level: location.level,
    zoneId: location.zoneId,
    zoneName: location.zoneId ? zoneById.get(location.zoneId) ?? null : null,
  }));
}

async function loadLotsForOrders(orders: Order[]): Promise<PickListLot[]> {
  const itemIds = [...new Set(
    orders.flatMap((order) =>
      (order.lines ?? [])
        .filter((line) => line.trackLot && (line.remaining ?? 0) > 0)
        .map((line) => line.itemId),
    ),
  )];
  if (!itemIds.length) return [];
  const items = await Promise.all(itemIds.map((id) => api<Item>(`/api/items/${id}`).catch(() => null)));
  const lots: PickListLot[] = [];
  for (const item of items) {
    if (!item) continue;
    for (const lot of item.lots ?? []) {
      lots.push({
        locationId: lot.locationId,
        sku: item.sku,
        lotCode: lot.lotCode,
        qty: lot.qty,
        expiresOn: lot.expiresOn,
      });
    }
  }
  return lots;
}

async function lookupNames(input: {
  waveId?: string | null;
  clientId?: string | null;
  zoneId?: string | null;
  warehouseId?: string | null;
  sessionWarehouses: { id: string; name: string }[];
}): Promise<{
  waveNumber: string | null;
  zoneName: string | null;
  clientCode: string | null;
  warehouseName: string | null;
}> {
  let waveNumber: string | null = null;
  let zoneId = input.zoneId ?? null;
  let clientId = input.clientId ?? null;
  if (input.waveId) {
    const wave = await api<Wave>(`/api/waves/${input.waveId}`).catch(() => null);
    if (wave) {
      waveNumber = wave.number;
      zoneId = zoneId || wave.zoneId || null;
      clientId = clientId || wave.clientId || null;
    }
  }
  const [clients, zones] = await Promise.all([
    clientId ? api<Client[]>("/api/clients").catch(() => [] as Client[]) : Promise.resolve([] as Client[]),
    zoneId ? api<Zone[]>("/api/zones").catch(() => [] as Zone[]) : Promise.resolve([] as Zone[]),
  ]);
  const zone = zoneId ? zones.find((row) => row.id === zoneId) : null;
  const client = clientId ? clients.find((row) => row.id === clientId) : null;
  return {
    waveNumber,
    zoneName: zone ? zone.name || zone.code : null,
    clientCode: client?.code ?? null,
    warehouseName: input.sessionWarehouses.find((row) => row.id === input.warehouseId)?.name ?? null,
  };
}

export function OrderPickListPage() {
  const { id } = useParams();
  const me = useSession();
  const [doc, setDoc] = useState<ReturnType<typeof buildOrderPickList> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const [order, locations, jobs] = await Promise.all([
          api<Order>(`/api/orders/${id}`),
          loadLocationsWithZones(),
          api<FloorJob[]>("/api/jobs?open=1&verb=pick").catch(() => [] as FloorJob[]),
        ]);
        const lots = await loadLotsForOrders([order]);
        const names = await lookupNames({
          waveId: order.waveId,
          clientId: order.clientId,
          warehouseId: order.warehouseId,
          sessionWarehouses: me.warehouses,
        });
        const picker = jobs.find((job) => job.refType === "order" && job.refId === order.id);
        if (cancelled) return;
        setDoc(
          buildOrderPickList({
            order: orderToInput(order),
            locations,
            lots,
            warehouseName: names.warehouseName,
            waveNumber: names.waveNumber,
            zoneName: names.zoneName,
            clientCode: names.clientCode,
            pickerName: picker?.assigneeName ?? null,
          }),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load pick list");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, me.warehouses]);

  if (!doc) return <ErrorBanner error={error} />;
  return <OrderPickListSheet doc={doc} orgName={me.organization.name} backTo={`/outbound/orders/${id}`} />;
}

export function WavePickListPage() {
  const { id } = useParams();
  const me = useSession();
  const [doc, setDoc] = useState<ReturnType<typeof buildWavePickList> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const [wave, locations] = await Promise.all([
          api<Wave>(`/api/waves/${id}`),
          loadLocationsWithZones(),
        ]);
        const memberOrders = await Promise.all((wave.orders ?? []).map((row) => api<Order>(`/api/orders/${row.id}`)));
        const lots = await loadLotsForOrders(memberOrders);
        const names = await lookupNames({
          clientId: wave.clientId,
          zoneId: wave.zoneId,
          warehouseId: wave.warehouseId,
          sessionWarehouses: me.warehouses,
        });
        if (cancelled) return;
        setDoc(
          buildWavePickList({
            wave: { number: wave.number, mode: wave.mode, status: wave.status, notes: wave.notes },
            orders: memberOrders.map(orderToInput),
            locations,
            lots,
            zoneName: names.zoneName,
            clientCode: names.clientCode,
          }),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load pick list");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, me.warehouses]);

  if (!doc) return <ErrorBanner error={error} />;
  return <WavePickListSheet doc={doc} orgName={me.organization.name} backTo={`/outbound/waves/${id}`} />;
}
