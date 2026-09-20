import { describe, expect, it } from "vitest";
import { isCrossWarehouse, resolveTransferWarehouses, warehousesForMovements } from "./multi-warehouse";

describe("multi-warehouse", () => {
  it("detects cross-warehouse moves", () => {
    expect(isCrossWarehouse("a", "b")).toBe(true);
    expect(isCrossWarehouse("a", "a")).toBe(false);
  });

  it("stamps toWarehouseId only when buildings differ", () => {
    expect(
      resolveTransferWarehouses({ fromWarehouseId: "main", toWarehouseId: "west" }),
    ).toEqual({ warehouseId: "main", toWarehouseId: "west" });
    expect(
      resolveTransferWarehouses({ fromWarehouseId: "main", toWarehouseId: "main" }),
    ).toEqual({ warehouseId: "main", toWarehouseId: null });
  });

  it("collects warehouses touched by movements", () => {
    const map = new Map([
      ["loc-a", "main"],
      ["loc-b", "west"],
    ]);
    const set = warehousesForMovements(
      [{ fromLocationId: "loc-a", toLocationId: "loc-b" }],
      map,
    );
    expect([...set].sort()).toEqual(["main", "west"]);
  });
});
