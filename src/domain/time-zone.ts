export const DEFAULT_TIME_ZONE = "UTC";

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** IANA zone. Empty and unknown names throw so warehouse save can return HTTP 400. */
export function parseTimeZone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid timezone");
  const zone = value.trim();
  if (!isValidTimeZone(zone)) throw new Error("Invalid timezone");
  return zone;
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const num = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  let hour = num("hour");
  if (hour === 24) hour = 0;
  return {
    year: num("year"),
    month: num("month"),
    day: num("day"),
    hour,
    minute: num("minute"),
    second: num("second"),
  };
}

function wallClockOffset(ms: number, timeZone: string): number {
  const parts = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - ms;
}

/** UTC epoch of local midnight for the calendar day that contains `ms` in `timeZone`. */
export function startOfZonedDay(ms: number, timeZone: string): number {
  const parts = zonedParts(ms, timeZone);
  const midnightGuess = Date.UTC(parts.year, parts.month - 1, parts.day) - wallClockOffset(ms, timeZone);
  const atMidnight = zonedParts(midnightGuess, timeZone);
  if (
    atMidnight.year === parts.year &&
    atMidnight.month === parts.month &&
    atMidnight.day === parts.day &&
    atMidnight.hour === 0 &&
    atMidnight.minute === 0
  ) {
    return midnightGuess;
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day) - wallClockOffset(midnightGuess, timeZone);
}

/** Last millisecond of the local calendar day that contains `ms`. */
export function endOfZonedDay(ms: number, timeZone: string): number {
  const start = startOfZonedDay(ms, timeZone);
  const next = startOfZonedDay(start + 36 * 60 * 60 * 1000, timeZone);
  return next - 1;
}
