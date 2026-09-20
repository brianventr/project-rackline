/** Multi-warehouse transfer helpers. */

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
