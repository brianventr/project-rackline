import type { Dashboard } from "./api";
import { useApiQuery } from "./query";
import { useWarehouse } from "./warehouse";

export function dashboardPath(warehouseId: string): string {
  return `/api/dashboard${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ""}`;
}

/**
 * The warehouse's live counts. Today and the sidebar badges share this one cached read,
 * refreshed every minute and after every write.
 */
export function useDashboard() {
  const { warehouseId } = useWarehouse();
  return useApiQuery<Dashboard>(dashboardPath(warehouseId), { refetchInterval: 60_000 });
}
