export type ShipServiceHub = {
  /** The building `defaultService` belongs to. */
  warehouseId: string | null;
  defaultService?: { serviceId: string } | null;
  enabledServices: { id: string; isDefault?: boolean }[];
};

/** The service a ship screen starts on: the order's own, then its building's default, then the default carrier's first. */
export function startingShipService(
  order: { carrierService?: string | null; warehouseId?: string | null },
  hub: ShipServiceHub | null | undefined,
): string {
  const sameBuilding = !order.warehouseId || order.warehouseId === hub?.warehouseId;
  return (
    order.carrierService?.trim() ||
    (sameBuilding ? hub?.defaultService?.serviceId : null) ||
    hub?.enabledServices.find((row) => row.isDefault)?.id ||
    "rackline_ground"
  );
}
