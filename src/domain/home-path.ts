import { isGarageMode } from "./operating-mode";

/**
 * Where a person lands after sign-in. Garage Mode opens the ship queue for everyone.
 * Manufacturer mode puts operators on the floor and everyone else on Today.
 */
export function homePath(role: string | null | undefined, operatingMode?: string | null): string {
  if (role === "picker") return "/floor";
  if (role === "bookkeeper") return "/setup/accounting";
  if (role === "viewer") return "/stock";
  if (role === "support") return "/outbound/returns";
  if (isGarageMode(operatingMode)) return "/ship";
  return role === "operator" ? "/floor" : "/today";
}
