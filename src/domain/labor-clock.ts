export type LaborClockRow = {
  id: string;
  startedAt: number;
  endedAt: number | null;
};

export function durationSeconds(startedAt: number, endedAt: number): number {
  const sec = Math.floor((endedAt - startedAt) / 1000);
  return sec < 0 ? 0 : sec;
}

export function closeClock(input: { startedAt: number; endedAt: number }): { endedAt: number; durationSec: number } {
  return {
    endedAt: input.endedAt,
    durationSec: durationSeconds(input.startedAt, input.endedAt),
  };
}

export function openClocksForUser(clocks: LaborClockRow[], now: number): (LaborClockRow & { elapsedSec: number })[] {
  return clocks
    .filter((row) => row.endedAt == null)
    .map((row) => ({
      ...row,
      elapsedSec: durationSeconds(row.startedAt, now),
    }));
}
