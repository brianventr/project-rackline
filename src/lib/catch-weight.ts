import { badRequest } from "./http";
import { requireCatchWeight, requireCountCatchWeight } from "../domain/catch-weight";

export function lineCatchWeight(catchWeight: boolean | undefined, sku: string, raw: unknown): number | null {
  try {
    return requireCatchWeight(Boolean(catchWeight), sku, raw);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Invalid catch-weight");
  }
}

export function countCatchWeight(
  catchWeight: boolean | undefined,
  sku: string,
  countedQty: number,
  raw: unknown,
): number | null {
  try {
    return requireCountCatchWeight(Boolean(catchWeight), sku, countedQty, raw);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Invalid catch-weight");
  }
}
