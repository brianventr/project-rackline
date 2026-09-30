import { isGarageMode } from "./operating-mode";

/**
 * Where a person lands after sign-in. Garage Mode opens the ship queue for everyone.
 * Manufacturer mode puts operators on the floor and everyone else on Today.
 */
export function homePath(role: string | null | undefined, operatingMode?: string | null): string {
  if (isGarageMode(operatingMode)) return "/ship";
  return role === "operator" ? "/floor" : "/today";
}
