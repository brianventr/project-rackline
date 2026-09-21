/** Days of cover from this client's on-hand and their own shipped units. */
export function clientRunwayDays(onHand: number, shippedUnits: number, periodDays = 30): number | null {
  if (!Number.isFinite(onHand) || onHand <= 0) return shippedUnits > 0 ? 0 : null;
  if (!Number.isFinite(shippedUnits) || shippedUnits <= 0 || periodDays <= 0) return null;
  const daily = shippedUnits / periodDays;
  if (daily <= 0) return null;
  return Math.floor(onHand / daily);
}
