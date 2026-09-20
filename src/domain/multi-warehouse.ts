/** Multi-warehouse transfer helpers. */

import type { MovementDraft } from "./inventory";

export function isCrossWarehouse(fromWarehouseId: string, toWarehouseId: string): boolean {
  return fromWarehouseId !== toWarehouseId;
}

export function resolveTransferWarehouses(input: {
  fromWarehouseId: string;
  toWarehouseId: string;
  bodyWarehouseId?: string;
}): { warehouseId: string; toWarehouseId: string | null } {
  const warehouseId = input.bodyWarehouseId || input.fromWarehouseId;
  const toWarehouseId = isCrossWarehouse(input.fromWarehouseId, input.toWarehouseId)
    ? input.toWarehouseId
    : null;
  return { warehouseId, toWarehouseId };
}

export function warehousesForMovements(
  movements: Pick<MovementDraft, "fromLocationId" | "toLocationId">[],
  locationWarehouseId: Map<string, string>,
): Set<string> {
  const ids = new Set<string>();
  for (const movement of movements) {
    if (movement.fromLocationId) {
      const wh = locationWarehouseId.get(movement.fromLocationId);
      if (wh) ids.add(wh);
    }
    if (movement.toLocationId) {
      const wh = locationWarehouseId.get(movement.toLocationId);
      if (wh) ids.add(wh);
    }
  }
  return ids;
}
