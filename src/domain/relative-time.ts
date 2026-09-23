const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5m ago", "3h ago", "2d ago", then a short date. Future times read "in 5m". */
export function relativeTime(at: number, now: number = Date.now()): string {
  const delta = now - at;
  const future = delta < 0;
  const abs = Math.abs(delta);
  if (abs < 45_000) return "just now";
  let text: string;
  if (abs < HOUR) text = `${Math.round(abs / MINUTE)}m`;
  else if (abs < DAY) text = `${Math.round(abs / HOUR)}h`;
  else if (abs < 14 * DAY) text = `${Math.round(abs / DAY)}d`;
  else {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(at));
  }
  return future ? `in ${text}` : `${text} ago`;
}

/** Whole days between `at` and now, floored. Used for age markers on queues. */
export function ageInDays(at: number, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - at) / DAY));
}
