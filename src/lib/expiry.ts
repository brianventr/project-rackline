import { badRequest } from "./http";
import { ExpiredLotError, requireExpiry } from "../domain/expiry";

export function lineExpiry(trackExpiry: boolean | undefined, sku: string, raw: unknown): number | null {
  try {
    return requireExpiry(Boolean(trackExpiry), sku, raw);
  } catch (err) {
    if (err instanceof ExpiredLotError) badRequest(err.message);
    badRequest(err instanceof Error ? err.message : "Invalid expiry");
  }
}
