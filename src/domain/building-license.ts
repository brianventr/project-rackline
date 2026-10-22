import { isGarageMode } from "./operating-mode";
import { PLANS, type PlanId } from "./plans";

/** The priced plan a shop is on. Shop is a homepage tier; the running mode is Garage or Manufacturer. */
export type LicensePlan = "garage" | "manufacturer";

export function planForOperatingMode(mode: string | null | undefined): LicensePlan {
  return isGarageMode(mode) ? "garage" : "manufacturer";
}

export function buildingPrice(plan: PlanId): number {
  const row = PLANS.find((item) => item.id === plan);
  if (!row) throw new Error(`Unknown plan ${plan}`);
  return row.price;
}

export type LicenseDraft = {
  warehouseId: string;
  plan: LicensePlan;
  priceDollars: number;
};

/** One license per building that does not have one yet, at the plan's current price. */
export function licensesForUncovered(
  warehouseIds: readonly string[],
  coveredIds: ReadonlySet<string>,
  plan: LicensePlan,
): LicenseDraft[] {
  const priceDollars = buildingPrice(plan);
  return warehouseIds
    .filter((warehouseId) => !coveredIds.has(warehouseId))
    .map((warehouseId) => ({ warehouseId, plan, priceDollars }));
}

export function monthlyLicenseTotal(prices: readonly number[]): number {
  return prices.reduce((sum, price) => sum + price, 0);
}
