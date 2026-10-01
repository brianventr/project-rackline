import type { ExceptionInbox, ExceptionSeverity, ExceptionVerb, ExceptionView } from "@/domain/exceptions/inbox";
import type { StatusTone } from "@/domain/status";
import { apiMutate, useApiQuery } from "./query";
import { useWarehouse } from "./warehouse";

export function exceptionsPath(warehouseId: string): string | null {
  return warehouseId ? `/api/exceptions?warehouseId=${encodeURIComponent(warehouseId)}` : null;
}

/**
 * The building's exception inbox. The page, the sidebar badge, Today, the ship queue, and the floor
 * share this one cached read, refreshed every minute and after every write.
 */
export function useExceptionInbox() {
  const { warehouseId } = useWarehouse();
  return useApiQuery<ExceptionInbox>(exceptionsPath(warehouseId), { refetchInterval: 60_000 });
}

export const SEVERITY_TONE: Record<ExceptionSeverity, StatusTone> = {
  blocking: "danger",
  warning: "warning",
  info: "info",
};

export type ExceptionChange = { cleared: boolean; item: ExceptionView | null };

export type ExceptionChangeInput = { takeOver?: boolean; hours?: number; note?: string; actionId?: string };

/** An inline action changes the problem's source, so it refreshes every read rather than just the inbox. */
export function changeException(
  warehouseId: string,
  item: Pick<ExceptionView, "source" | "key">,
  verb: ExceptionVerb,
  input: ExceptionChangeInput = {},
): Promise<ExceptionChange> {
  return apiMutate<ExceptionChange>(`/api/exceptions/${encodeURIComponent(item.source)}/${encodeURIComponent(item.key)}/${verb}`, {
    body: JSON.stringify({ warehouseId, ...input }),
    refresh: verb === "action" ? undefined : "/api/exceptions",
  });
}
