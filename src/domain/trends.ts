import { startOfZonedDay } from "./time-zone";

export type TrendMovement = { type: string; qty: number; createdAt: number; refId: string };

export type TrendDay = {
  /** UTC epoch of local midnight for this day. */
  start: number;
  received: number;
  picked: number;
  shipped: number;
  built: number;
  shippedOrders: number;
};

/**
 * Units per local calendar day for the last `days` days, oldest first, today last.
 * Days follow the warehouse timezone so "today" matches the Live wall.
 */
export function dailyTrend(
  movements: readonly TrendMovement[],
  now: number,
  timeZone: string,
  days = 7,
): TrendDay[] {
  const starts: number[] = [startOfZonedDay(now, timeZone)];
  while (starts.length < days) starts.unshift(startOfZonedDay(starts[0]! - 1, timeZone));
  const buckets: TrendDay[] = starts.map((start) => ({
    start,
    received: 0,
    picked: 0,
    shipped: 0,
    built: 0,
    shippedOrders: 0,
  }));
  const shippedRefs = buckets.map(() => new Set<string>());
  for (const movement of movements) {
    if (movement.createdAt < starts[0]! || movement.createdAt > now) continue;
    let index = buckets.length - 1;
    while (index > 0 && movement.createdAt < starts[index]!) index -= 1;
    const bucket = buckets[index]!;
    const qty = Math.abs(movement.qty);
    if (movement.type === "receive") bucket.received += qty;
    else if (movement.type === "pick") bucket.picked += qty;
    else if (movement.type === "ship") {
      bucket.shipped += qty;
      shippedRefs[index]!.add(movement.refId);
    } else if (movement.type === "wo_produce" || movement.type === "kit_produce") bucket.built += qty;
  }
  buckets.forEach((bucket, index) => {
    bucket.shippedOrders = shippedRefs[index]!.size;
  });
  return buckets;
}
