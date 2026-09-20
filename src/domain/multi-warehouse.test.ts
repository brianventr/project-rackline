import { describe, expect, it } from "vitest";
import { isCrossWarehouse, resolveTransferWarehouses } from "./multi-warehouse";

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
});
