export const LABOR_VERBS = [
  "receive",
  "pick",
  "pack",
  "ship",
  "count",
  "move",
  "putaway",
  "replenish",
  "hold",
  "kit",
  "assemble",
  "yard",
  "batch_pick",
] as const;

export type LaborVerbName = (typeof LABOR_VERBS)[number];

export function isLaborVerb(value: string): value is LaborVerbName {
  return (LABOR_VERBS as readonly string[]).includes(value);
}

export type LaborRollup = {
  userId: string;
  userName: string;
  events: number;
  qty: number;
  durationSec: number;
};

export function rollupLabor(
  events: { userId: string; userName: string; qty: number | null; durationSec: number | null }[],
): LaborRollup[] {
  const byUser = new Map<string, LaborRollup>();
  for (const event of events) {
    const row = byUser.get(event.userId) ?? {
      userId: event.userId,
      userName: event.userName,
      events: 0,
      qty: 0,
      durationSec: 0,
    };
    row.events += 1;
    row.qty += event.qty ?? 0;
    row.durationSec += event.durationSec ?? 0;
    byUser.set(event.userId, row);
  }
  return [...byUser.values()].sort((a, b) => b.events - a.events);
}
